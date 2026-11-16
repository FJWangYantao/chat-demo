import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginAlias, isTrustedRequestOrigin } from '../requestOrigin.ts'
import { createWeChatAI } from './ai.ts'
import {
  DEFAULT_WECHAT_API_ORIGIN,
  fetchWeChatQrCode,
  normalizeWeChatOrigin,
  pollWeChatQrCode,
} from './ilink.ts'
import { createWeChatMessaging } from './messaging.ts'
import type { StoredConnection, WeChatAI } from './types.ts'

type LoginStatus =
  | 'pending'
  | 'scanned'
  | 'pin_required'
  | 'connected'
  | 'already_connected'
  | 'cancelled'
  | 'expired'
  | 'failed'

type LoginAttempt = {
  id: string
  browserId: string
  qrcode: string
  qrContent: string
  status: LoginStatus
  pinError: boolean
  pendingPin?: string
  error?: string
  controller: AbortController
  expiresAt: number
}

type WeChatOptions = {
  origin: string
  dataDir: string
  apiOrigin: string
  ai: WeChatAI
  allowFrom: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const readCookies = (request: IncomingMessage) => {
  const cookies = new Map<string, string>()
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index > 0) {
      cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
    }
  }
  return cookies
}

const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks: Uint8Array[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16384) {
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

const publicConnection = (connection: StoredConnection | undefined) =>
  connection
    ? {
        id: connection.id,
        accountId: connection.accountId,
        userId: connection.userId,
        connectedAt: connection.connectedAt,
      }
    : null

const isStoredConnection = (value: unknown): value is StoredConnection => {
  if (!isRecord(value)) {
    return false
  }
  try {
    return (
      typeof value.id === 'string' &&
      /^[a-zA-Z0-9_-]{32}$/.test(value.id) &&
      typeof value.browserId === 'string' &&
      /^[a-zA-Z0-9_-]{43}$/.test(value.browserId) &&
      typeof value.token === 'string' &&
      !!value.token &&
      value.token.length <= 8192 &&
      !/\s/.test(value.token) &&
      typeof value.accountId === 'string' &&
      /^[a-zA-Z0-9@._-]{1,128}$/.test(value.accountId) &&
      (value.userId === undefined ||
        (typeof value.userId === 'string' && value.userId.length <= 512)) &&
      typeof value.baseUrl === 'string' &&
      normalizeWeChatOrigin(value.baseUrl) === value.baseUrl &&
      typeof value.connectedAt === 'string' &&
      Number.isFinite(Date.parse(value.connectedAt))
    )
  } catch {
    return false
  }
}

const isRetryable = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof Error &&
    (['AbortError', 'TimeoutError'].includes(error.name) ||
      error.message === 'wechat_invalid_json' ||
      /^wechat_http_(?:408|429|5\d\d)$/.test(error.message)))

export const createWeChatMiddleware = (options: Partial<WeChatOptions> = {}) => {
  const origin = new URL(options.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:8090')
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
  ) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin and use HTTPS outside localhost.')
  }
  const apiOrigin = normalizeWeChatOrigin(options.apiOrigin ?? DEFAULT_WECHAT_API_ORIGIN)
  const dataDir =
    options.dataDir ??
    process.env.WECHAT_DATA_DIR ??
    fileURLToPath(new URL('../../data/wechat/', import.meta.url))
  const dataFile = path.join(dataDir, 'connections.json')
  const ai = options.ai ?? createWeChatAI()
  const messaging = createWeChatMessaging({
    dataDir,
    ai,
    allowFrom: options.allowFrom ?? process.env.WECHAT_ALLOW_FROM,
  })
  const secure = origin.protocol === 'https:'
  const browserCookie = secure ? '__Host-chat-demo-wechat-browser' : 'chat-demo-wechat-browser'
  const connections = new Map<string, StoredConnection>()
  const attempts = new Map<string, LoginAttempt>()
  let writes = Promise.resolve()

  const ready = (async () => {
    try {
      const body: unknown = JSON.parse(await readFile(dataFile, 'utf8'))
      if (isRecord(body) && body.version === 1 && Array.isArray(body.connections)) {
        for (const value of body.connections.slice(0, 10000)) {
          if (isStoredConnection(value)) {
            connections.set(value.browserId, value)
          }
        }
      }
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') {
        process.stderr.write('[WeChat] Unable to restore local connections.\n')
      }
    }
    await Promise.all([...connections.values()].map((connection) => messaging.start(connection)))
  })()

  const persist = () => {
    writes = writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dataDir, { recursive: true, mode: 0o700 })
        const temporary = `${dataFile}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
        await writeFile(
          temporary,
          JSON.stringify({ version: 1, connections: [...connections.values()] }, null, 2),
          { mode: 0o600 }
        )
        await rename(temporary, dataFile)
      })
    return writes
  }

  const cookie = (value: string) =>
    `${browserCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`

  const browserIdFor = (request: IncomingMessage, response: ServerResponse) => {
    const current = readCookies(request).get(browserCookie) ?? ''
    if (/^[a-zA-Z0-9_-]{43}$/.test(current)) {
      return current
    }
    const id = randomBytes(32).toString('base64url')
    response.setHeader('Set-Cookie', cookie(id))
    return id
  }

  const finish = (attempt: LoginAttempt, status: LoginStatus, error?: string) => {
    if (attempt.controller.signal.aborted && status !== 'cancelled') {
      return
    }
    attempt.status = status
    attempt.error = error
    attempt.pendingPin = undefined
    attempt.expiresAt = Date.now() + 60000
  }

  const cleanExpired = () => {
    const now = Date.now()
    for (const [id, attempt] of attempts) {
      if (attempt.expiresAt <= now) {
        attempt.controller.abort()
        attempts.delete(id)
      }
    }
  }

  const runLogin = async (attempt: LoginAttempt) => {
    const browserConnection = connections.get(attempt.browserId)
    const localTokens = browserConnection ? [browserConnection.token] : []
    let currentApiOrigin = apiOrigin
    let refreshCount = 0
    const deadline = Date.now() + 480000
    const refresh = async () => {
      refreshCount += 1
      if (refreshCount > 3) {
        finish(attempt, 'expired', 'expired')
        return false
      }
      const qr = await fetchWeChatQrCode(apiOrigin, localTokens, attempt.controller.signal)
      attempt.qrcode = qr.id
      attempt.qrContent = qr.content
      attempt.status = 'pending'
      attempt.pinError = false
      attempt.pendingPin = undefined
      return true
    }
    try {
      while (Date.now() < deadline && !attempt.controller.signal.aborted) {
        if (attempt.status === 'pin_required' && !attempt.pendingPin) {
          await delay(250, undefined, { signal: attempt.controller.signal })
          continue
        }
        const pin = attempt.pendingPin
        attempt.pendingPin = undefined
        let result
        try {
          result = await pollWeChatQrCode(
            currentApiOrigin,
            attempt.qrcode,
            pin,
            attempt.controller.signal
          )
        } catch (error) {
          if (attempt.controller.signal.aborted) {
            return
          }
          if (isRetryable(error)) {
            await delay(1000, undefined, { signal: attempt.controller.signal })
            continue
          }
          throw error
        }
        if (result.status.includes('need_verifycode')) {
          attempt.status = 'pin_required'
          attempt.pinError = Boolean(pin)
          continue
        }
        switch (result.status) {
          case 'wait':
            break
          case 'scaned':
            attempt.status = 'scanned'
            attempt.pinError = false
            break
          case 'scaned_but_redirect':
            if (result.redirectHost) {
              currentApiOrigin = normalizeWeChatOrigin(`https://${result.redirectHost}`)
            }
            attempt.status = 'scanned'
            break
          case 'expired':
          case 'verify_code_blocked':
            if (!(await refresh())) {
              return
            }
            break
          case 'binded_redirect':
            finish(
              attempt,
              connections.has(attempt.browserId) ? 'connected' : 'already_connected',
              connections.has(attempt.browserId) ? undefined : 'already_connected'
            )
            return
          case 'confirmed': {
            if (
              !result.botToken ||
              result.botToken.length > 8192 ||
              /\s/.test(result.botToken) ||
              !result.accountId ||
              !/^[a-zA-Z0-9@._-]{1,128}$/.test(result.accountId)
            ) {
              throw new Error('wechat_invalid_confirmed_response')
            }
            const previous = connections.get(attempt.browserId)
            const connection: StoredConnection = {
              id: randomBytes(24).toString('base64url'),
              browserId: attempt.browserId,
              token: result.botToken,
              accountId: result.accountId,
              userId: result.userId?.slice(0, 512) || undefined,
              baseUrl: result.baseUrl ? normalizeWeChatOrigin(result.baseUrl) : apiOrigin,
              connectedAt: new Date().toISOString(),
            }
            connections.set(attempt.browserId, connection)
            try {
              await persist()
            } catch {
              if (previous) {
                connections.set(attempt.browserId, previous)
              } else {
                connections.delete(attempt.browserId)
              }
              finish(attempt, 'failed', 'storage')
              return
            }
            if (previous && previous.id !== connection.id) {
              await messaging.clear(previous.id).catch(() => {
                process.stderr.write('[WeChat] Unable to clear previous message state.\n')
              })
            }
            await messaging.start(connection)
            finish(attempt, 'connected')
            return
          }
          default:
            throw new Error('wechat_unknown_status')
        }
        await delay(1000, undefined, { signal: attempt.controller.signal })
      }
      if (!attempt.controller.signal.aborted) {
        finish(attempt, 'expired', 'expired')
      }
    } catch (error) {
      if (!attempt.controller.signal.aborted) {
        process.stderr.write(
          `[WeChat] Login failed: ${error instanceof Error ? error.message : 'unknown error'}\n`
        )
        finish(attempt, 'failed', 'failed')
      }
    }
  }

  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let url: URL
    try {
      url = new URL(request.url ?? '/', origin)
    } catch {
      json(response, 400, { error: 'invalid_url' })
      return
    }
    if (!url.pathname.startsWith('/api/wechat/')) {
      next()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    if (
      !isTrustedRequestOrigin(request, origin) ||
      request.headers['x-chat-demo-request'] !== '1' ||
      (request.method === 'POST' && !isSameOriginAlias(origin, request.headers.origin))
    ) {
      json(response, 403, { error: 'untrusted_request' })
      return
    }
    cleanExpired()

    const run = async () => {
      await ready
      const browserId = browserIdFor(request, response)
      if (request.method === 'GET' && url.pathname === '/api/wechat/session') {
        const connection = connections.get(browserId)
        json(response, 200, {
          available: true,
          connection: publicConnection(connection),
          ai: {
            ...ai.status(),
            messaging: connection ? messaging.status(connection.id) : 'stopped',
          },
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/wechat/login') {
        if (attempts.size >= 100) {
          json(response, 503, { error: 'server_busy' })
          return
        }
        for (const attempt of attempts.values()) {
          if (attempt.browserId === browserId) {
            attempt.controller.abort()
            attempts.delete(attempt.id)
          }
        }
        const qr = await fetchWeChatQrCode(
          apiOrigin,
          (() => {
            const connection = connections.get(browserId)
            return connection ? [connection.token] : []
          })()
        )
        const attempt: LoginAttempt = {
          id: randomBytes(24).toString('base64url'),
          browserId,
          qrcode: qr.id,
          qrContent: qr.content,
          status: 'pending',
          pinError: false,
          controller: new AbortController(),
          expiresAt: Date.now() + 480000,
        }
        attempts.set(attempt.id, attempt)
        json(response, 200, {
          id: attempt.id,
          status: attempt.status,
          qrContent: attempt.qrContent,
        })
        void runLogin(attempt)
        return
      }
      const attemptId = url.searchParams.get('attempt') ?? ''
      let input: Record<string, unknown> = {}
      if (['POST'].includes(request.method ?? '') && url.pathname !== '/api/wechat/logout') {
        const body = await readBody(request)
        if (!isRecord(body)) {
          json(response, 400, { error: 'invalid_request' })
          return
        }
        input = body
      }
      const id = attemptId || (typeof input.attempt === 'string' ? input.attempt : '')
      const attempt = attempts.get(id)
      if (attempt && attempt.browserId !== browserId) {
        json(response, 404, { error: 'invalid_attempt' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/wechat/status') {
        if (!attempt) {
          json(response, 404, { error: 'invalid_attempt' })
          return
        }
        json(response, 200, {
          status: attempt.status,
          qrContent: attempt.qrContent,
          pinError: attempt.pinError,
          error: attempt.error,
          connection:
            attempt.status === 'connected' ? publicConnection(connections.get(browserId)) : null,
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/wechat/pin') {
        if (
          !attempt ||
          attempt.status !== 'pin_required' ||
          typeof input.code !== 'string' ||
          !/^\d{1,16}$/.test(input.code)
        ) {
          json(response, 400, { error: 'invalid_pin' })
          return
        }
        attempt.pendingPin = input.code
        attempt.pinError = false
        json(response, 200, { status: attempt.status })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/wechat/cancel') {
        if (!attempt) {
          json(response, 404, { error: 'invalid_attempt' })
          return
        }
        attempt.status = 'cancelled'
        attempt.controller.abort()
        attempt.expiresAt = Date.now() + 60000
        json(response, 200, { status: attempt.status })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/wechat/logout') {
        for (const item of attempts.values()) {
          if (item.browserId === browserId) {
            item.controller.abort()
          }
        }
        const previous = connections.get(browserId)
        if (previous) {
          await messaging.stop(previous.id)
        }
        connections.delete(browserId)
        try {
          await persist()
        } catch {
          if (previous) {
            connections.set(browserId, previous)
            await messaging.start(previous)
          }
          json(response, 500, { error: 'storage' })
          return
        }
        if (previous) {
          await messaging.clear(previous.id).catch(() => {
            process.stderr.write('[WeChat] Unable to clear disconnected message state.\n')
          })
        }
        json(response, 200, { connection: null })
        return
      }
      json(response, 404, { error: 'not_found' })
    }
    void run().catch((error: unknown) => {
      if (!response.headersSent) {
        json(response, 502, {
          error:
            error instanceof Error && error.message === 'body_limit'
              ? 'body_limit'
              : 'wechat_request_failed',
        })
      } else if (!response.writableEnded) {
        response.end()
      }
    })
  }

  return Object.assign(middleware, {
    shutdown: async () => {
      for (const attempt of attempts.values()) {
        attempt.controller.abort()
      }
      await ready
      await messaging.stopAll()
    },
  })
}
