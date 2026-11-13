import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type GitHubOAuthOptions = {
  origin: string
  clientId: string
  clientSecret: string
}

type PendingLogin = { verifier: string; expiresAt: number }
type Session = { token: string; login: string; expiresAt: number }
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
    for (const [id, value] of pending) {
      if (value.expiresAt <= now) {
        pending.delete(id)
      }
    }
    for (const [id, value] of sessions) {
      if (value.expiresAt <= now) {
        sessions.delete(id)
      }
    }
  }
  const sameOrigin = (value: string | undefined) => {
    try {
      return (
        value !== undefined &&
        new URL(value).origin !== 'null' &&
        new URL(value).origin === origin.origin
      )
    } catch {
      return false
    }
  }
  const upstream = (url: string, init: RequestInit) =>
    fetch(url, {
      ...init,
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
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
    if (
      request.headers.host !== origin.host ||
      (request.headers.origin && !sameOrigin(request.headers.origin))
    ) {
      json(response, 403, { error: 'untrusted_origin' })
      return
    }
    cleanExpired()
    const cookies = readCookies(request)
    const sessionId = cookies.get(sessionCookie) ?? ''
    const session = sessions.get(sessionId)
    const requestedState = cookies.get(stateCookie) ?? ''
    const isCallback = url.pathname === '/auth/github/callback'
    const controller = new AbortController()
    const onClose = () => {
      if (!response.writableEnded) {
        controller.abort()
      }
    }
    response.once('close', onClose)

    const run = async () => {
      if (request.method === 'GET' && url.pathname === '/auth/github/session') {
        json(response, 200, { configured, authenticated: Boolean(session), login: session?.login })
        return
      }
      if (request.method === 'GET' && url.pathname === '/auth/github/login') {
        if (!configured) {
          redirect(response, '/?github_auth=unconfigured')
          return
        }
        if (pending.size >= 1000 || sessions.size >= 10000) {
          json(response, 503, { error: 'server_busy' })
          return
        }
        pending.delete(requestedState)
        const state = randomBytes(32).toString('base64url')
        const verifier = randomBytes(32).toString('base64url')
        pending.set(state, { verifier, expiresAt: Date.now() + 600000 })
        response.setHeader('Set-Cookie', cookie(stateCookie, state, 600))
        const authorize = new URL('https://github.com/login/oauth/authorize')
        authorize.searchParams.set('client_id', clientId)
        authorize.searchParams.set('redirect_uri', callback)
        authorize.searchParams.set(
          'scope',
          url.searchParams.get('private') === '1' ? 'read:user repo' : 'read:user public_repo'
        )
        authorize.searchParams.set('state', state)
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
          redirect(response, '/?github_auth=invalid_state')
          return
        }
        pending.delete(state)
        response.setHeader('Set-Cookie', cookie(stateCookie, '', 0))
        if (url.searchParams.has('error')) {
          redirect(response, '/?github_auth=denied')
          return
        }
        const code = url.searchParams.get('code')
        if (!code || code.length > 512) {
          redirect(response, '/?github_auth=failed')
          return
        }
        const tokenResponse = await upstream('https://github.com/login/oauth/access_token', {
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
        })
        const token: unknown = await tokenResponse.json()
        if (
          !tokenResponse.ok ||
          !isRecord(token) ||
          typeof token.access_token !== 'string' ||
          !token.access_token ||
          token.token_type !== 'bearer' ||
          token.error
        ) {
          redirect(response, '/?github_auth=failed')
          return
        }
        const userResponse = await upstream('https://api.github.com/user', {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token.access_token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        })
        const user: unknown = await userResponse.json()
        if (
          !userResponse.ok ||
          !isRecord(user) ||
          typeof user.login !== 'string' ||
          !/^[a-zA-Z0-9-]+$/.test(user.login)
        ) {
          redirect(response, '/?github_auth=failed')
          return
        }
        const id = randomBytes(32).toString('base64url')
        const age =
          typeof token.expires_in === 'number' &&
          Number.isFinite(token.expires_in) &&
          token.expires_in > 0
            ? Math.min(28800, Math.floor(token.expires_in))
            : 28800
        sessions.delete(sessionId)
        sessions.set(id, {
          token: token.access_token,
          login: user.login,
          expiresAt: Date.now() + age * 1000,
        })
        response.setHeader('Set-Cookie', [
          cookie(stateCookie, '', 0),
          cookie(sessionCookie, id, age),
        ])
        redirect(response, '/?github_auth=connected')
        return
      }
      if (
        request.headers['x-chat-demo-request'] !== '1' ||
        (request.method === 'POST' && !sameOrigin(request.headers.origin))
      ) {
        json(response, 403, { error: 'untrusted_request' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/auth/github/logout') {
        sessions.delete(sessionId)
        pending.delete(requestedState)
        response.setHeader('Set-Cookie', [cookie(sessionCookie, '', 0), cookie(stateCookie, '', 0)])
        json(response, 200, { authenticated: false })
        return
      }
      if (!proxy || !['GET', 'POST'].includes(request.method ?? '')) {
        json(response, 404, { error: 'not_found' })
        return
      }
      if (!session) {
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
          Authorization: `Bearer ${session.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (upstreamResponse.status === 401) {
        sessions.delete(sessionId)
        response.setHeader('Set-Cookie', cookie(sessionCookie, '', 0))
      }
      const result: unknown = await upstreamResponse.json()
      json(response, upstreamResponse.status, result)
    }
    void run()
      .catch((error: unknown) => {
        if (response.destroyed || response.writableEnded) {
          return
        }
        if (isCallback) {
          redirect(response, '/?github_auth=failed')
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
      })
      .finally(() => response.off('close', onClose))
  }
}
