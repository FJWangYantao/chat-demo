import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendGitHubOAuthCompletion } from './githubOAuthCompletion.ts'
import { isSameOriginAlias, isTrustedRequestOrigin } from './requestOrigin.ts'

export type GitHubOAuthOptions = {
  origin: string
  clientId: string
  clientSecret: string
}

type LoginResult =
  | 'pending'
  | 'connected'
  | 'denied'
  | 'invalid_state'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'unconfigured'
  | 'network_error'
  | 'invalid_credentials'
  | 'code_expired'
type LoginAttempt = {
  browser: string
  privateRepositories: boolean
  login?: string
  locale: 'zh-CN' | 'en-US'
  status: LoginResult
  state?: string
  connectionId?: string
  sessionId?: string
  expiresAt: number
}
type PendingLogin = {
  verifier: string
  privateRepositories: boolean
  expiresAt: number
  attemptId?: string
}
type Connection = {
  id: string
  token: string
  login: string
  privateRepositories: boolean
  expiresAt: number
}
type Session = {
  connections: Map<string, Connection>
  lastConnectedId: string
  expiresAt: number
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readCookies = (request: IncomingMessage) =>
  new Map(
    (request.headers.cookie ?? '').split(';').map((part) => {
      const index = part.indexOf('=')
      return [part.slice(0, index).trim(), part.slice(index + 1)]
    })
  )

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks: Uint8Array[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 65536) {
        reject(new Error('body_limit'))
      } else {
        chunks.push(new Uint8Array(chunk))
      }
    })
    request.on('error', reject)
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new Error('invalid_json'))
      }
    })
  })

export const createGitHubOAuthMiddleware = (options: Partial<GitHubOAuthOptions> = {}) => {
  const origin = new URL(options.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:8090')
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.')
  }
  if (
    origin.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  ) {
    throw new Error('APP_ORIGIN must use HTTPS outside localhost.')
  }
  const clientId = options.clientId ?? process.env.GITHUB_CLIENT_ID ?? ''
  const clientSecret = options.clientSecret ?? process.env.GITHUB_CLIENT_SECRET ?? ''
  const configured = Boolean(clientId && clientSecret)
  const secure = origin.protocol === 'https:'
  const sessionCookie = secure ? '__Host-chat-demo-github' : 'chat-demo-github'
  const stateCookie = secure ? '__Host-chat-demo-github-state' : 'chat-demo-github-state'
  const browserCookie = secure ? '__Host-chat-demo-github-browser' : 'chat-demo-github-browser'
  const attempts = new Map<string, LoginAttempt>()
  const callback = `${origin.origin}/auth/github/callback`
  const pending = new Map<string, PendingLogin>()
  const sessions = new Map<string, Session>()
  const cookie = (name: string, value: string, age: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`
  const redirect = (response: ServerResponse, location: string) => {
    response.writeHead(302, { Location: location })
    response.end()
  }
  const cleanExpired = () => {
    const now = Date.now()
    for (const [id, value] of attempts) {
      if (value.expiresAt <= now) {
        attempts.delete(id)
      }
    }
    for (const [id, value] of pending) {
      if (value.expiresAt <= now) {
        pending.delete(id)
      }
    }
    for (const [id, value] of sessions) {
      if (value.expiresAt <= now) {
        sessions.delete(id)
      } else {
        for (const [connectionId, connection] of value.connections) {
          if (connection.expiresAt <= now) {
            value.connections.delete(connectionId)
          }
        }
      }
    }
  }
  const sameOrigin = (value: string | undefined) =>
    value !== undefined && isSameOriginAlias(origin, value)
  const upstream = (url: string, init: RequestInit, timeout = 30000) =>
    fetch(url, {
      ...init,
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    })

  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let url: URL
    try {
      url = new URL(request.url ?? '/', origin)
    } catch {
      json(response, 400, { error: 'invalid_url' })
      return
    }
    const auth = url.pathname.startsWith('/auth/github/')
    const proxy = url.pathname.startsWith('/api/github/')
    if (!auth && !proxy) {
      next()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    if (!isTrustedRequestOrigin(request, origin)) {
      json(response, 403, { error: 'untrusted_origin' })
      return
    }
    cleanExpired()
    const cookies = readCookies(request)
    const sessionId = cookies.get(sessionCookie) ?? ''
    const session = sessions.get(sessionId)
    const requestedState = cookies.get(stateCookie) ?? ''
    const isCallback = url.pathname === '/auth/github/callback'
    const loginState = isCallback
      ? (pending.get(url.searchParams.get('state') ?? '') ?? pending.get(requestedState))
      : undefined
    const attemptId = isCallback
      ? loginState?.attemptId
      : (url.searchParams.get('attempt') ?? undefined)
    const attempt = attemptId ? attempts.get(attemptId) : undefined
    const ownedAttempt = attempt?.browser === cookies.get(browserCookie) ? attempt : undefined
    const complete = (result: Exclude<LoginResult, 'pending'>, connectionId?: string) => {
      if (ownedAttempt && attemptId) {
        if (ownedAttempt.status === 'pending') {
          ownedAttempt.status = result
          ownedAttempt.connectionId = connectionId
        }
      }
    }
    const finishCallback = (result: Exclude<LoginResult, 'pending'>, connectionId?: string) => {
      complete(result, connectionId)
      if (response.writableEnded) {
        return
      }
      if (ownedAttempt && attemptId) {
        redirect(response, `/auth/github/complete?attempt=${attemptId}`)
      } else {
        redirect(response, `/?github_auth=${result}`)
      }
    }
    let callbackStage = 'token_exchange'
    const controller = new AbortController()
    const onClose = () => {
      if (!isCallback && !response.writableEnded) {
        controller.abort()
      }
    }
    response.once('close', onClose)

    const run = async () => {
      if (request.method === 'GET' && url.pathname === '/auth/github/session') {
        json(response, 200, {
          configured,
          authenticated: Boolean(session?.connections.size),
          lastConnectedId: session?.lastConnectedId,
          connections: [...(session?.connections.values() ?? [])].map(
            ({ id, login, privateRepositories, expiresAt }) => ({
              id,
              login,
              privateRepositories,
              expiresAt,
            })
          ),
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/auth/github/complete') {
        if (!ownedAttempt) {
          json(response, 404, { error: 'invalid_attempt' })
          return
        }
        sendGitHubOAuthCompletion(response, ownedAttempt.locale)
        return
      }
      if (request.method === 'GET' && url.pathname === '/auth/github/login') {
        if (attemptId && (!ownedAttempt || ownedAttempt.status !== 'pending')) {
          json(response, 400, { error: 'invalid_attempt' })
          return
        }
        if (!configured) {
          finishCallback('unconfigured')
          return
        }
        if (pending.size >= 1000 || sessions.size >= 10000) {
          json(response, 503, { error: 'server_busy' })
          return
        }
        const previousLogin = pending.get(requestedState)
        const previousAttempt = previousLogin?.attemptId
          ? attempts.get(previousLogin.attemptId)
          : undefined
        if (previousAttempt?.status === 'pending') {
          previousAttempt.status = 'cancelled'
        }
        pending.delete(requestedState)
        const state = randomBytes(32).toString('base64url')
        const verifier = randomBytes(32).toString('base64url')
        const privateRepositories =
          ownedAttempt?.privateRepositories ?? url.searchParams.get('private') === '1'
        pending.set(state, {
          verifier,
          privateRepositories,
          expiresAt: Date.now() + 600000,
          attemptId,
        })
        if (ownedAttempt) {
          ownedAttempt.state = state
        }
        response.setHeader('Set-Cookie', cookie(stateCookie, state, 600))
        const authorize = new URL('https://github.com/login/oauth/authorize')
        authorize.searchParams.set('client_id', clientId)
        authorize.searchParams.set('redirect_uri', callback)
        authorize.searchParams.set(
          'scope',
          privateRepositories ? 'read:user repo' : 'read:user public_repo'
        )
        authorize.searchParams.set('state', state)
        authorize.searchParams.set('prompt', 'select_account')
        const loginHint = ownedAttempt?.login ?? url.searchParams.get('login')
        if (loginHint && /^[a-zA-Z0-9-]+$/.test(loginHint)) {
          authorize.searchParams.set('login', loginHint)
        }
        authorize.searchParams.set(
          'code_challenge',
          createHash('sha256').update(verifier).digest('base64url')
        )
        authorize.searchParams.set('code_challenge_method', 'S256')
        redirect(response, authorize.href)
        return
      }
      if (request.method === 'GET' && isCallback) {
        const state = url.searchParams.get('state') ?? ''
        const login = pending.get(state)
        if (
          !login ||
          !/^[a-zA-Z0-9_-]{43}$/.test(state) ||
          state.length !== requestedState.length ||
          !/^[a-zA-Z0-9_-]{43}$/.test(requestedState) ||
          !timingSafeEqual(
            new TextEncoder().encode(state),
            new TextEncoder().encode(requestedState)
          )
        ) {
          finishCallback('invalid_state')
          return
        }
        pending.delete(state)
        response.setHeader('Set-Cookie', cookie(stateCookie, '', 0))
        if (url.searchParams.has('error')) {
          finishCallback('denied')
          return
        }
        if (ownedAttempt && ownedAttempt.status !== 'pending') {
          finishCallback(ownedAttempt.status)
          return
        }
        const code = url.searchParams.get('code')
        if (!code || code.length > 512) {
          finishCallback('failed')
          return
        }
        if (ownedAttempt && attemptId) {
          redirect(response, `/auth/github/complete?attempt=${attemptId}`)
        } else {
          redirect(response, '/?github_auth=pending')
        }
        const tokenResponse = await upstream(
          'https://github.com/login/oauth/access_token',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              redirect_uri: callback,
              code_verifier: login.verifier,
            }).toString(),
          },
          ownedAttempt ? ownedAttempt.expiresAt - Date.now() : 30000
        )
        const token: unknown = await tokenResponse.json()
        if (
          !tokenResponse.ok ||
          !isRecord(token) ||
          typeof token.access_token !== 'string' ||
          !token.access_token ||
          token.token_type !== 'bearer' ||
          token.error
        ) {
          const code = isRecord(token) && typeof token.error === 'string' ? token.error : ''
          const result =
            code === 'incorrect_client_credentials' ||
            code === 'invalid_client' ||
            tokenResponse.status === 404
              ? 'invalid_credentials'
              : code === 'bad_verification_code'
                ? 'code_expired'
                : 'failed'
          process.stderr.write(
            `[GitHub OAuth] token_exchange failed: ${result}, HTTP ${tokenResponse.status}\n`
          )
          finishCallback(result)
          return
        }
        callbackStage = 'user_profile'
        const userResponse = await upstream(
          'https://api.github.com/user',
          {
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token.access_token}`,
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
          ownedAttempt ? ownedAttempt.expiresAt - Date.now() : 30000
        )
        const user: unknown = await userResponse.json()
        if (
          !userResponse.ok ||
          !isRecord(user) ||
          typeof user.login !== 'string' ||
          !/^[a-zA-Z0-9-]+$/.test(user.login)
        ) {
          finishCallback('failed')
          return
        }
        if (
          ownedAttempt &&
          (ownedAttempt.status !== 'pending' || ownedAttempt.expiresAt <= Date.now())
        ) {
          finishCallback(ownedAttempt.status === 'pending' ? 'expired' : ownedAttempt.status)
          return
        }
        const id = randomBytes(32).toString('base64url')
        const age =
          typeof token.expires_in === 'number' &&
          Number.isFinite(token.expires_in) &&
          token.expires_in > 0
            ? Math.min(28800, Math.floor(token.expires_in))
            : 28800
        const connections = new Map(session?.connections)
        for (const [connectionId, connection] of connections) {
          if (connection.login.toLowerCase() === user.login.toLowerCase()) {
            connections.delete(connectionId)
          }
        }
        const connectionId = randomBytes(24).toString('base64url')
        connections.set(connectionId, {
          id: connectionId,
          token: token.access_token,
          login: user.login,
          privateRepositories:
            typeof token.scope === 'string'
              ? token.scope.split(/[ ,]+/).includes('repo')
              : login.privateRepositories,
          expiresAt: Date.now() + age * 1000,
        })
        sessions.delete(sessionId)
        sessions.set(id, {
          connections,
          lastConnectedId: connectionId,
          expiresAt: Date.now() + 28800000,
        })
        if (!ownedAttempt) {
          response.setHeader('Set-Cookie', [
            cookie(stateCookie, '', 0),
            cookie(sessionCookie, id, 28800),
          ])
        }
        if (ownedAttempt) {
          ownedAttempt.sessionId = id
        }
        finishCallback('connected', connectionId)
        return
      }
      if (
        request.headers['x-chat-demo-request'] !== '1' ||
        (request.method === 'POST' && !sameOrigin(request.headers.origin))
      ) {
        json(response, 403, { error: 'untrusted_request' })
        return
      }
      if (url.pathname === '/auth/github/attempt') {
        if (request.method === 'POST') {
          if (!configured || attempts.size >= 1000) {
            json(response, configured ? 503 : 400, {
              error: configured ? 'server_busy' : 'unconfigured',
            })
            return
          }
          const input = await readBody(request)
          if (
            !isRecord(input) ||
            typeof input.privateRepositories !== 'boolean' ||
            (input.login !== undefined &&
              (typeof input.login !== 'string' || !/^[a-zA-Z0-9-]+$/.test(input.login)))
          ) {
            json(response, 400, { error: 'invalid_attempt' })
            return
          }
          const browser = cookies.get(browserCookie) ?? randomBytes(32).toString('base64url')
          const id = randomBytes(24).toString('base64url')
          attempts.set(id, {
            browser,
            privateRepositories: input.privateRepositories,
            login: typeof input.login === 'string' ? input.login : undefined,
            locale: input.locale === 'en-US' ? 'en-US' : 'zh-CN',
            status: 'pending',
            expiresAt: Date.now() + 600000,
          })
          response.setHeader('Set-Cookie', cookie(browserCookie, browser, 28800))
          json(response, 200, { id, loginUrl: `/auth/github/login?attempt=${id}` })
          return
        }
        if (request.method === 'GET') {
          if (!ownedAttempt) {
            json(response, 404, { error: 'invalid_attempt' })
            return
          }
          if (ownedAttempt.status === 'connected') {
            const completedId = ownedAttempt.sessionId
            const completedSession = completedId ? sessions.get(completedId) : undefined
            if (
              !completedId ||
              !ownedAttempt.connectionId ||
              !completedSession?.connections.has(ownedAttempt.connectionId)
            ) {
              json(response, 200, { status: 'expired' })
              return
            }
            if (sessionId !== completedId) {
              response.setHeader(
                'Set-Cookie',
                cookie(
                  sessionCookie,
                  completedId,
                  Math.max(1, Math.floor((completedSession.expiresAt - Date.now()) / 1000))
                )
              )
            }
          }
          json(response, 200, {
            status: ownedAttempt.status,
            connectionId: ownedAttempt.connectionId,
          })
          return
        }
      }
      if (request.method === 'POST' && url.pathname === '/auth/github/cancel') {
        if (!ownedAttempt) {
          json(response, 404, { error: 'invalid_attempt' })
          return
        }
        if (ownedAttempt.status === 'pending') {
          ownedAttempt.status = 'cancelled'
        }
        json(response, 200, { status: ownedAttempt.status })
        return
      }
      const connectionId = request.headers['x-github-connection']
      const connection =
        typeof connectionId === 'string' ? session?.connections.get(connectionId) : undefined
      if (request.method === 'POST' && url.pathname === '/auth/github/logout') {
        if (typeof connectionId !== 'string' || !/^[a-zA-Z0-9_-]{32}$/.test(connectionId)) {
          json(response, 400, { error: 'invalid_connection' })
          return
        }
        session?.connections.delete(connectionId)
        if (!session?.connections.size) {
          sessions.delete(sessionId)
          pending.delete(requestedState)
          response.setHeader('Set-Cookie', [
            cookie(sessionCookie, '', 0),
            cookie(stateCookie, '', 0),
          ])
        }
        json(response, 200, { authenticated: Boolean(session?.connections.size) })
        return
      }
      if (!proxy || !['GET', 'POST'].includes(request.method ?? '')) {
        json(response, 404, { error: 'not_found' })
        return
      }
      if (!connection) {
        json(response, 401, { error: 'not_authenticated' })
        return
      }
      const path = url.pathname.slice('/api/github'.length)
      const repoPath = /^\/repos\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+/
      const isRead =
        path === '/search/repositories' ||
        (repoPath.test(path) &&
          /^\/repos\/[^/]+\/[^/]+(?:\/issues(?:\/[1-9][0-9]*)?|\/contents(?:\/.*)?)?$/.test(path))
      const isWrite = /^\/repos\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+\/issues$/.test(path)
      if ((request.method === 'GET' && !isRead) || (request.method === 'POST' && !isWrite)) {
        json(response, 403, { error: 'unsupported_operation' })
        return
      }
      let body: { title: string; body: string } | undefined
      if (request.method === 'POST') {
        const input = await readBody(request)
        if (
          !isRecord(input) ||
          typeof input.title !== 'string' ||
          !input.title.trim() ||
          input.title.length > 256 ||
          typeof input.body !== 'string' ||
          input.body.length > 30000 ||
          Object.keys(input).some((key) => key !== 'title' && key !== 'body')
        ) {
          json(response, 400, { error: 'invalid_issue' })
          return
        }
        body = { title: input.title, body: input.body }
      }
      const upstreamResponse = await upstream(`https://api.github.com${path}${url.search}`, {
        method: request.method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${connection.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (upstreamResponse.status === 401) {
        session?.connections.delete(connection.id)
      }
      const result: unknown = await upstreamResponse.json()
      json(response, upstreamResponse.status, result)
    }
    void run()
      .catch((error: unknown) => {
        if (isCallback) {
          const networkError =
            error instanceof TypeError ||
            (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
          const result = networkError
            ? ownedAttempt && ownedAttempt.expiresAt <= Date.now()
              ? 'expired'
              : 'network_error'
            : 'failed'
          process.stderr.write(`[GitHub OAuth] ${callbackStage} failed: ${result}\n`)
          finishCallback(result)
        } else {
          if (response.writableEnded) {
            return
          }
          if (response.headersSent) {
            response.end()
          } else {
            json(
              response,
              error instanceof Error && error.message === 'body_limit'
                ? 413
                : error instanceof Error && error.message === 'invalid_json'
                  ? 400
                  : 502,
              { error: 'github_request_failed' }
            )
          }
        }
      })
      .finally(() => response.off('close', onClose))
  }
}
