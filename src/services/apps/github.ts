import { create } from 'zustand'
import { translate } from '../../i18n/index.js'
import type { ClientTool } from '../api/types.js'
import { cancelToolApprovals } from './approvals.js'

const STORAGE_KEY = 'chat-demo:github'
const API_ORIGIN = 'https://api.github.com'

type Connection =
  | { token: string; login: string; auth?: 'token' }
  | { token: null; login: string; auth: 'oauth' }

const readConnection = (): Connection | null => {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (
      isRecord(value) &&
      typeof value.token === 'string' &&
      value.token.trim() &&
      typeof value.login === 'string' &&
      /^[a-zA-Z0-9-]+$/.test(value.login)
    ) {
      return { token: value.token, login: value.login }
    }
  } catch {
    return null
  }
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const useGitHub = create<{
  connection: Connection | null
  oauthConfigured: boolean
  oauthLoading: boolean
  oauthError: string
  disconnecting: boolean
}>(() => ({
  connection: readConnection(),
  oauthConfigured: false,
  oauthLoading: false,
  oauthError: '',
  disconnecting: false,
}))

const setConnection = (connection: Connection | null) => {
  try {
    if (connection?.token) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(connection))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // 存储不可用时，连接仅在本次页面内生效。
  }
  useGitHub.setState({ connection })
}

const activeRequests = new Set<AbortController>()

const sessionRequest = async (path: string, method = 'GET') => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    return await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Chat-Demo-Request': '1' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export const restoreGitHubSession = async (authResult: string | null = null) => {
  if (!['http:', 'https:'].includes(window.location.protocol)) {
    return
  }
  useGitHub.setState({ oauthLoading: true, oauthError: '' })
  try {
    const response = await sessionRequest('/auth/github/session')
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
      if (authResult) {
        useGitHub.setState({ oauthError: translate('githubOAuthFailed') })
      }
      return
    }
    const status: unknown = await response.json()
    if (!isRecord(status)) {
      return
    }
    useGitHub.setState({ oauthConfigured: status.configured === true })
    if (
      status.authenticated === true &&
      typeof status.login === 'string' &&
      /^[a-zA-Z0-9-]+$/.test(status.login)
    ) {
      if (
        !useGitHub.getState().connection ||
        useGitHub.getState().connection?.auth === 'oauth' ||
        authResult === 'connected'
      ) {
        setConnection({ token: null, login: status.login, auth: 'oauth' })
      }
    } else if (useGitHub.getState().connection?.auth === 'oauth') {
      setConnection(null)
    }
    if (authResult && authResult !== 'connected') {
      const key =
        authResult === 'denied'
          ? 'githubOAuthDenied'
          : authResult === 'invalid_state'
            ? 'githubOAuthInvalidState'
            : authResult === 'unconfigured'
              ? 'githubOAuthUnconfigured'
              : 'githubOAuthFailed'
      useGitHub.setState({ oauthError: translate(key) })
    } else if (authResult === 'connected' && status.authenticated !== true) {
      useGitHub.setState({ oauthError: translate('githubOAuthFailed') })
    }
  } catch {
    if (authResult) {
      useGitHub.setState({ oauthError: translate('githubOAuthFailed') })
    }
  } finally {
    useGitHub.setState({ oauthLoading: false })
  }
}

export const startGitHubLogin = (privateRepositories: boolean) => {
  window.location.assign(`/auth/github/login${privateRepositories ? '?private=1' : ''}`)
}

export const disconnectGitHub = async () => {
  if (useGitHub.getState().disconnecting) {
    return
  }
  cancelToolApprovals()
  for (const controller of activeRequests) {
    controller.abort()
  }
  useGitHub.setState({ disconnecting: true, oauthError: '' })
  try {
    if (useGitHub.getState().connection?.auth === 'oauth' || useGitHub.getState().oauthConfigured) {
      const response = await sessionRequest('/auth/github/logout', 'POST')
      if (!response.ok) {
        throw new Error('logout_failed')
      }
    }
    setConnection(null)
  } catch {
    useGitHub.setState({ oauthError: translate('githubOAuthLogoutFailed') })
  } finally {
    useGitHub.setState({ disconnecting: false })
  }
}

const githubRequest = async (
  token: string | null,
  path: string,
  signal: AbortSignal,
  body?: unknown
): Promise<unknown> => {
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  activeRequests.add(controller)
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(token === null ? `/api/github${path}` : `${API_ORIGIN}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token === null
          ? { 'X-Chat-Demo-Request': '1' }
          : { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: token === null ? 'same-origin' : 'omit',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      if (token === null && response.status === 401) {
        setConnection(null)
        cancelToolApprovals()
        useGitHub.setState({ oauthError: translate('githubOAuthExpired') })
      }
      const key =
        response.status === 401
          ? token === null
            ? 'githubOAuthExpired'
            : 'githubUnauthorized'
          : response.status === 403 || response.status === 429
            ? 'githubForbidden'
            : response.status === 404
              ? 'githubNotFound'
              : 'githubRequestFailed'
      throw new Error(translate(key, { status: response.status }))
    }
    return await response.json()
  } catch (error) {
    signal.throwIfAborted()
    if (controller.signal.aborted || (body !== undefined && error instanceof TypeError)) {
      throw new Error(translate('githubInterrupted'))
    }
    if (error instanceof TypeError) {
      throw new Error(translate('githubNetworkError'))
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    activeRequests.delete(controller)
  }
}

export const connectGitHub = async (value: string, signal: AbortSignal) => {
  const token = value.trim()
  if (!token || /\s/.test(token)) {
    throw new Error(translate('githubInvalidToken'))
  }
  const user = await githubRequest(token, '/user', signal)
  signal.throwIfAborted()
  if (!isRecord(user) || typeof user.login !== 'string' || !/^[a-zA-Z0-9-]+$/.test(user.login)) {
    throw new Error(translate('githubInvalidResponse'))
  }
  setConnection({ token, login: user.login })
  useGitHub.setState({ oauthError: '' })
}

const repositoryProperties = {
  owner: { type: 'string', description: 'GitHub repository owner or organization.' },
  repo: { type: 'string', description: 'Repository name, without the owner.' },
}

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): ClientTool => ({
  name,
  description,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
})

const TOOLS: ClientTool[] = [
  tool(
    'github_search_repositories',
    'Search GitHub repositories visible to the connected account using GitHub search syntax. Returns up to 10 results.',
    { query: { type: 'string', description: 'GitHub repository search query.' } },
    ['query']
  ),
  tool(
    'github_get_repository',
    'Read repository description, default branch, language, stars and URL.',
    repositoryProperties,
    ['owner', 'repo']
  ),
  tool(
    'github_list_issues',
    'List up to 20 recent issues or pull requests in a repository, with body excerpts.',
    {
      ...repositoryProperties,
      state: { type: 'string', enum: ['open', 'closed', 'all'] },
      page: { type: 'integer', minimum: 1, maximum: 1000 },
    },
    ['owner', 'repo']
  ),
  tool(
    'github_get_issue',
    'Read a GitHub issue or pull request by its number. Returns its title, body, state and URL.',
    { ...repositoryProperties, issue_number: { type: 'integer', minimum: 1 } },
    ['owner', 'repo', 'issue_number']
  ),
  tool(
    'github_read_file',
    'Read a UTF-8 text file up to 48 KiB, or list up to 100 directory entries. Use an empty path for the repository root. Supply ref for a branch, tag or commit.',
    {
      ...repositoryProperties,
      path: { type: 'string', description: 'Path relative to repository root.' },
      ref: { type: 'string', description: 'Optional branch, tag or commit.' },
    },
    ['owner', 'repo', 'path']
  ),
  tool(
    'github_create_issue',
    'Create an issue only when the user requests it. The app shows the exact repository, title and body and waits for user approval. Never claim success until the tool returns success. Do not retry an interrupted creation without checking GitHub first.',
    {
      ...repositoryProperties,
      title: { type: 'string', maxLength: 256 },
      body: { type: 'string', maxLength: 30000 },
    },
    ['owner', 'repo', 'title', 'body']
  ),
]

export const getGitHubTools = (): ClientTool[] => {
  const { connection, disconnecting } = useGitHub.getState()
  return connection && !disconnecting ? TOOLS : []
}

export const isGitHubWriteTool = (name: string) => name === 'github_create_issue'

const string = (input: Record<string, unknown>, key: string, max = 256, allowEmpty = false) => {
  const value = input[key]
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) {
    throw new Error(translate('githubInvalidArguments'))
  }
  return value
}

const integer = (value: unknown, max: number) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(translate('githubInvalidArguments'))
  }
  return value
}

export const validateGitHubCall = (name: string, value: unknown): Record<string, unknown> => {
  const definition = TOOLS.find((item) => item.name === name)
  if (!definition || !isRecord(value)) {
    throw new Error(translate('githubInvalidArguments'))
  }
  if (Object.keys(value).some((key) => !Object.hasOwn(definition.input_schema.properties, key))) {
    throw new Error(translate('githubInvalidArguments'))
  }
  if (name === 'github_search_repositories') {
    string(value, 'query', 256)
    return value
  }
  const owner = string(value, 'owner', 39)
  const repo = string(value, 'repo', 100)
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) ||
    !/^[a-zA-Z0-9_.-]+$/.test(repo) ||
    /^\.{1,2}$/.test(repo)
  ) {
    throw new Error(translate('githubInvalidArguments'))
  }
  switch (name) {
    case 'github_list_issues':
      if (value.state !== undefined && !['open', 'closed', 'all'].includes(String(value.state))) {
        throw new Error(translate('githubInvalidArguments'))
      }
      if (value.page !== undefined) {
        integer(value.page, 1000)
      }
      break
    case 'github_get_issue':
      integer(value.issue_number, Number.MAX_SAFE_INTEGER)
      break
    case 'github_read_file': {
      const path = string(value, 'path', 1024, true)
      if (
        path &&
        path
          .split('/')
          .some((part) => !part || part === '.' || part === '..' || part.includes('\\'))
      ) {
        throw new Error(translate('githubInvalidArguments'))
      }
      if (value.ref !== undefined) {
        string(value, 'ref', 255)
      }
      break
    }
    case 'github_create_issue':
      string(value, 'title', 256)
      string(value, 'body', 30000, true)
      break
  }
  return value
}

const pick = (value: unknown, keys: string[]): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(translate('githubInvalidResponse'))
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}

const issue = (value: unknown) => {
  const result = pick(value, ['number', 'title', 'state', 'html_url', 'body', 'pull_request'])
  if (typeof result.body === 'string' && result.body.length > 16000) {
    result.body = `${result.body.slice(0, 16000)}\n[truncated]`
  }
  return result
}

export const executeGitHubCall = async (
  name: string,
  value: unknown,
  signal: AbortSignal,
  approved = false
): Promise<string> => {
  const input = validateGitHubCall(name, value)
  const connection = useGitHub.getState().connection
  if (!connection || useGitHub.getState().disconnecting) {
    throw new Error(translate('githubDisconnected'))
  }
  if (isGitHubWriteTool(name) && !approved) {
    throw new Error(translate('githubApprovalRequired'))
  }
  const request = (path: string, body?: unknown) =>
    githubRequest(connection.token, path, signal, body)
  const base = `/repos/${encodeURIComponent(String(input.owner))}/${encodeURIComponent(String(input.repo))}`
  let result: unknown
  switch (name) {
    case 'github_search_repositories': {
      const response = await request(
        `/search/repositories?q=${encodeURIComponent(String(input.query))}&per_page=10`
      )
      if (!isRecord(response) || !Array.isArray(response.items)) {
        throw new Error(translate('githubInvalidResponse'))
      }
      result = {
        total_count: response.total_count,
        items: response.items.map((item) =>
          pick(item, [
            'full_name',
            'description',
            'html_url',
            'language',
            'stargazers_count',
            'default_branch',
          ])
        ),
      }
      break
    }
    case 'github_get_repository':
      result = pick(await request(base), [
        'full_name',
        'description',
        'html_url',
        'language',
        'stargazers_count',
        'default_branch',
        'private',
        'open_issues_count',
      ])
      break
    case 'github_list_issues': {
      const response = await request(
        `${base}/issues?state=${input.state ?? 'open'}&per_page=20&page=${input.page ?? 1}`
      )
      if (!Array.isArray(response)) {
        throw new Error(translate('githubInvalidResponse'))
      }
      result = response.map((item) => {
        const data = issue(item)
        if (typeof data.body === 'string') {
          data.body = data.body.slice(0, 1200)
        }
        return data
      })
      break
    }
    case 'github_get_issue':
      result = issue(await request(`${base}/issues/${input.issue_number}`))
      break
    case 'github_create_issue':
      result = issue(await request(`${base}/issues`, { title: input.title, body: input.body }))
      break
    case 'github_read_file': {
      const path = String(input.path).split('/').map(encodeURIComponent).join('/')
      const ref = input.ref === undefined ? '' : `?ref=${encodeURIComponent(String(input.ref))}`
      const response = await request(`${base}/contents/${path}${ref}`)
      if (Array.isArray(response)) {
        result = {
          entries: response
            .slice(0, 100)
            .map((item) => pick(item, ['name', 'path', 'type', 'size'])),
          truncated: response.length > 100,
        }
      } else {
        if (
          !isRecord(response) ||
          response.type !== 'file' ||
          response.encoding !== 'base64' ||
          typeof response.content !== 'string' ||
          typeof response.size !== 'number' ||
          response.size > 48 * 1024 ||
          response.content.length > 70000
        ) {
          throw new Error(translate('githubFileUnsupported'))
        }
        const bytes = Uint8Array.from(atob(response.content.replace(/\s/g, '')), (char) =>
          char.charCodeAt(0)
        )
        if (bytes.includes(0)) {
          throw new Error(translate('githubFileUnsupported'))
        }
        result = {
          path: response.path,
          sha: response.sha,
          content: new TextDecoder().decode(bytes),
        }
      }
      break
    }
  }
  return JSON.stringify(result)
}
