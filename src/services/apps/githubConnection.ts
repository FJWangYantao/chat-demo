import { create } from 'zustand'
import { translate } from '../../i18n/index.js'
import { cancelToolApprovals } from './approvals.js'

const STORAGE_KEY = 'chat-demo:github-connections'
const LEGACY_STORAGE_KEY = 'chat-demo:github'

export type GitHubConnection = {
  id: string
  login: string
  label: string
} & (
  | { auth: 'token'; token: string }
  | { auth: 'oauth'; token: null; privateRepositories: boolean; expiresAt: number }
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validLogin = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9-]+$/.test(value)

const readConnections = () => {
  const fallback = {
    connections: [] as GitHubConnection[],
    activeId: null as string | null,
    enabled: true,
  }
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isRecord(value) && Array.isArray(value.connections)) {
      const connections = value.connections.filter(
        (item): item is GitHubConnection =>
          isRecord(item) &&
          typeof item.id === 'string' &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(item.id) &&
          validLogin(item.login) &&
          typeof item.label === 'string' &&
          item.label.length <= 60 &&
          ((item.auth === 'token' &&
            typeof item.token === 'string' &&
            !!item.token &&
            !/\s/.test(item.token)) ||
            (item.auth === 'oauth' &&
              item.token === null &&
              typeof item.privateRepositories === 'boolean' &&
              typeof item.expiresAt === 'number' &&
              item.expiresAt > Date.now()))
      )
      return {
        connections,
        activeId: connections.some((item) => item.id === value.activeId)
          ? String(value.activeId)
          : null,
        enabled: value.enabled !== false,
      }
    }
    const legacy: unknown = JSON.parse(sessionStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null')
    if (
      isRecord(legacy) &&
      validLogin(legacy.login) &&
      typeof legacy.token === 'string' &&
      legacy.token.trim()
    ) {
      const connection: GitHubConnection = {
        id: crypto.randomUUID(),
        login: legacy.login,
        label: legacy.login,
        auth: 'token',
        token: legacy.token.trim(),
      }
      return { connections: [connection], activeId: connection.id, enabled: true }
    }
  } catch {
    return fallback
  }
  return fallback
}

const initial = readConnections()

export const useGitHub = create<{
  connections: GitHubConnection[]
  activeId: string | null
  enabled: boolean
  connection: GitHubConnection | null
  revision: number
  oauthVerified: boolean
  oauthConfigured: boolean
  oauthLoading: boolean
  oauthPending: boolean
  oauthError: string
  disconnecting: string | null
}>(() => ({
  ...initial,
  connection: initial.enabled
    ? (initial.connections.find((item) => item.id === initial.activeId) ?? null)
    : null,
  revision: 0,
  oauthVerified: false,
  oauthConfigured: false,
  oauthLoading:
    typeof window !== 'undefined' && ['http:', 'https:'].includes(window.location.protocol),
  oauthPending: false,
  oauthError: '',
  disconnecting: null,
}))

export const githubConnectionStatus = (state: ReturnType<typeof useGitHub.getState>) => {
  if (state.oauthPending) {
    return 'connectorConnecting' as const
  }
  if (!state.enabled) {
    return 'connectorInstalled' as const
  }
  const connected = state.connections.some(
    (item) => item.auth === 'token' || (state.oauthVerified && item.expiresAt > Date.now())
  )
  if (connected) {
    return 'connectorConnected' as const
  }
  return state.oauthLoading ? ('connectorChecking' as const) : ('connectorNotSignedIn' as const)
}

const activeRequests = new Map<AbortController, string | undefined>()

const interrupt = (id?: string) => {
  if (id === undefined || useGitHub.getState().connection?.id === id) {
    cancelToolApprovals()
  }
  for (const [controller, connectionId] of activeRequests) {
    if (id === undefined || id === connectionId) {
      controller.abort()
    }
  }
}

const setConnections = (
  connections: GitHubConnection[],
  activeId = useGitHub.getState().activeId,
  enabled = useGitHub.getState().enabled
) => {
  const previous = useGitHub.getState().connection
  const selected = connections.find((item) => item.id === activeId)
  const connection = enabled ? (selected ?? null) : null
  const changed = previous?.id !== connection?.id || previous?.token !== connection?.token
  if (changed) {
    interrupt()
  }
  useGitHub.setState({
    connections,
    activeId: selected?.id ?? null,
    enabled,
    connection,
    revision: useGitHub.getState().revision + Number(changed),
  })
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ connections, activeId: selected?.id ?? null, enabled })
    )
    sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // 存储不可用时，连接仅在本次页面内生效。
  }
}

export const setGitHubEnabled = (enabled: boolean) => {
  const { connections, activeId } = useGitHub.getState()
  setConnections(connections, activeId, enabled)
}

export const selectGitHubConnection = (id: string) => {
  const { connections, disconnecting } = useGitHub.getState()
  if (!disconnecting && connections.some((item) => item.id === id)) {
    setConnections(connections, id)
  }
}

export const renameGitHubConnection = (id: string, label: string) => {
  const { connections } = useGitHub.getState()
  setConnections(
    connections.map((item) =>
      item.id === id ? { ...item, label: label.trim().slice(0, 60) || item.login } : item
    )
  )
}

export const getGitHubConnection = () => {
  const { connection, disconnecting, oauthVerified } = useGitHub.getState()
  if (
    !connection ||
    connection.id === disconnecting ||
    (connection.auth === 'oauth' && !oauthVerified)
  ) {
    return null
  }
  if (connection.auth === 'oauth' && connection.expiresAt <= Date.now()) {
    return null
  }
  return connection
}

const removeConnection = (id: string) => {
  interrupt(id)
  setConnections(useGitHub.getState().connections.filter((item) => item.id !== id))
}

export const githubSessionRequest = async (
  path: string,
  method = 'GET',
  connectionId?: string,
  options: { signal?: AbortSignal; body?: unknown } = {}
) => {
  options.signal?.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    return await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Chat-Demo-Request': '1',
        ...(connectionId ? { 'X-GitHub-Connection': connectionId } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

let restoring: Promise<void> | null = null

export const restoreGitHubSession = (
  authResult: string | null = null,
  connectedId?: string
): Promise<void> => {
  if (restoring) {
    return authResult
      ? restoring.then(() => restoreGitHubSession(authResult, connectedId))
      : restoring
  }
  if (!['http:', 'https:'].includes(window.location.protocol)) {
    return Promise.resolve()
  }
  const run = async () => {
    useGitHub.setState({ oauthLoading: true, oauthError: '' })
    try {
      const response = await githubSessionRequest('/auth/github/session')
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
        throw new Error('invalid_session')
      }
      const status: unknown = await response.json()
      if (!isRecord(status) || !Array.isArray(status.connections)) {
        throw new Error('invalid_session')
      }
      const { connections: previous, activeId, enabled } = useGitHub.getState()
      const oauth = status.connections.flatMap((item): GitHubConnection[] => {
        if (
          !isRecord(item) ||
          typeof item.id !== 'string' ||
          !/^[a-zA-Z0-9_-]{32}$/.test(item.id) ||
          !validLogin(item.login) ||
          typeof item.expiresAt !== 'number' ||
          item.expiresAt <= Date.now()
        ) {
          return []
        }
        const old = previous.find(
          (connection) =>
            connection.auth === 'oauth' &&
            connection.login.toLowerCase() === String(item.login).toLowerCase()
        )
        return [
          {
            id: item.id,
            login: item.login,
            label: old?.label ?? item.login,
            auth: 'oauth',
            token: null,
            privateRepositories: item.privateRepositories === true,
            expiresAt: item.expiresAt,
          },
        ]
      })
      const connections = [...previous.filter((item) => item.auth === 'token'), ...oauth]
      const oldActive = previous.find((item) => item.id === activeId)
      const updated =
        oldActive?.auth === 'oauth'
          ? oauth.find((item) => item.login.toLowerCase() === oldActive.login.toLowerCase())
          : undefined
      const selected =
        connections.find((item) => item.id === activeId) ??
        updated ??
        (!activeId && authResult === 'connected'
          ? oauth.find((item) => item.id === (connectedId ?? status.lastConnectedId))
          : undefined)
      setConnections(connections, selected?.id ?? null, authResult === 'connected' ? true : enabled)
      useGitHub.setState({ oauthConfigured: status.configured === true, oauthVerified: true })
      if (authResult && authResult !== 'connected') {
        const key =
          authResult === 'denied'
            ? 'githubOAuthDenied'
            : authResult === 'invalid_state'
              ? 'githubOAuthInvalidState'
              : authResult === 'unconfigured'
                ? 'githubOAuthUnconfigured'
                : authResult === 'network_error'
                  ? 'githubOAuthNetworkError'
                  : authResult === 'invalid_credentials'
                    ? 'githubOAuthCredentialsError'
                    : authResult === 'code_expired'
                      ? 'githubOAuthCodeExpired'
                      : 'githubOAuthFailed'
        useGitHub.setState({ oauthError: translate(key) })
      } else if (
        authResult === 'connected' &&
        !oauth.some((item) => item.id === (connectedId ?? status.lastConnectedId))
      ) {
        useGitHub.setState({ oauthError: translate('githubOAuthFailed') })
      }
    } catch {
      useGitHub.setState({ oauthVerified: false, oauthError: translate('githubSessionFailed') })
    } finally {
      useGitHub.setState({ oauthLoading: false })
    }
  }
  restoring = run().finally(() => {
    restoring = null
  })
  return restoring
}

export const disconnectGitHub = async (id: string) => {
  const { connections, disconnecting } = useGitHub.getState()
  const connection = connections.find((item) => item.id === id)
  if (!connection || disconnecting) {
    return
  }
  interrupt(id)
  useGitHub.setState({ disconnecting: id, oauthError: '' })
  try {
    if (connection.auth === 'oauth') {
      const response = await githubSessionRequest('/auth/github/logout', 'POST', id)
      if (!response.ok) {
        throw new Error('logout_failed')
      }
    }
    removeConnection(id)
  } catch {
    useGitHub.setState({ oauthError: translate('githubOAuthLogoutFailed') })
  } finally {
    useGitHub.setState({ disconnecting: null })
  }
}

export const githubRequest = async (
  token: string | null,
  path: string,
  signal: AbortSignal,
  body?: unknown,
  connectionId?: string
): Promise<unknown> => {
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  activeRequests.set(controller, connectionId)
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(
      token === null ? `/api/github${path}` : `https://api.github.com${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          ...(token === null
            ? { 'X-Chat-Demo-Request': '1', 'X-GitHub-Connection': connectionId ?? '' }
            : { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: token === null ? 'same-origin' : 'omit',
        redirect: 'error',
        signal: controller.signal,
      }
    )
    if (!response.ok) {
      if (
        response.status === 401 &&
        connectionId &&
        useGitHub
          .getState()
          .connections.some((item) => item.id === connectionId && item.token === token)
      ) {
        activeRequests.delete(controller)
        removeConnection(connectionId)
        useGitHub.setState({
          oauthError: translate(token === null ? 'githubOAuthExpired' : 'githubUnauthorized'),
        })
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

export const connectGitHub = async (
  value: string,
  signal: AbortSignal,
  options: { label?: string; replaceId?: string } = {}
) => {
  const token = value.trim()
  if (!token || /\s/.test(token)) {
    throw new Error(translate('githubInvalidToken'))
  }
  const user = await githubRequest(token, '/user', signal)
  signal.throwIfAborted()
  if (!isRecord(user) || !validLogin(user.login)) {
    throw new Error(translate('githubInvalidResponse'))
  }
  const { connections, activeId } = useGitHub.getState()
  const previous = connections.find((item) => item.id === options.replaceId)
  if (
    options.replaceId &&
    (!previous ||
      previous.auth !== 'token' ||
      previous.login.toLowerCase() !== user.login.toLowerCase())
  ) {
    throw new Error(translate('githubAccountMismatch'))
  }
  const duplicate = connections.find((item) => item.auth === 'token' && item.token === token)
  const connection: GitHubConnection = {
    id: previous?.id ?? duplicate?.id ?? crypto.randomUUID(),
    login: user.login,
    label: options.label?.trim().slice(0, 60) || previous?.label || duplicate?.label || user.login,
    auth: 'token',
    token,
  }
  setConnections(
    [...connections.filter((item) => item.id !== connection.id), connection],
    activeId ?? connection.id,
    true
  )
  useGitHub.setState({ oauthError: '' })
}
