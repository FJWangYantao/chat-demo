import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  executeFetch,
  executeSearch,
  normalizeFetchUrl,
  SearchProviderError,
} from './searchProviders.ts'
import { isSameOriginAlias, isTrustedRequestOrigin } from './requestOrigin.ts'
import { SEARCH_PROVIDER_IDS, type SearchProviderId } from '../src/services/search/types.ts'

const BODY_LIMIT = 16 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        tooLarge = true
      } else {
        chunks.push(new Uint8Array(chunk))
      }
    })
    request.on('error', reject)
    request.on('end', () => {
      if (tooLarge) {
        reject(new SearchProviderError(413, 'Request body is too large.'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new SearchProviderError(400, 'Invalid JSON request.'))
      }
    })
  })

const query = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 128) {
    throw new SearchProviderError(400, 'Search query must contain 1–128 Unicode characters.')
  }
  return value.trim()
}

const question = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() && Array.from(value.trim()).length <= 128
    ? value.trim()
    : undefined

const provider = (value: unknown): SearchProviderId => {
  if (!SEARCH_PROVIDER_IDS.includes(value as SearchProviderId)) {
    throw new SearchProviderError(400, 'Select a supported search provider.')
  }
  return value as SearchProviderId
}

export const createSearchMiddleware = (
  appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:8090'
) => {
  const origin = new URL(appOrigin)
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = new URL(request.url ?? '/', origin).pathname
    if (!path.startsWith('/api/search/')) {
      next()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Vary', 'Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site')
    const fetchSite = request.headers['sec-fetch-site']
    if (
      !isTrustedRequestOrigin(request, origin) ||
      (typeof fetchSite === 'string' && !['same-origin', 'none'].includes(fetchSite))
    ) {
      json(response, 403, { error: { message: 'Untrusted request origin.' } })
      return
    }
    if (request.method !== 'POST' || !['/api/search/search', '/api/search/fetch'].includes(path)) {
      json(response, 404, { error: { message: 'Unknown search endpoint.' } })
      return
    }
    if (
      !isSameOriginAlias(origin, request.headers.origin) ||
      request.headers['x-chat-demo-request'] !== '1' ||
      !request.headers['content-type']?.includes('application/json')
    ) {
      json(response, 403, { error: { message: 'Use the application to send search requests.' } })
      return
    }
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    const invalidToken = [...token].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
    if (!token || token.length > 4096 || invalidToken) {
      json(response, 401, { error: { message: 'Configure a search service API key.' } })
      return
    }
    const controller = new AbortController()
    const abort = () => {
      if (!response.writableEnded) {
        controller.abort()
      }
    }
    response.once('close', abort)
    const run = async () => {
      const value = await readBody(request)
      if (!isRecord(value) || typeof value.baseUrl !== 'string' || value.baseUrl.length > 2048) {
        throw new SearchProviderError(400, 'Invalid search request.')
      }
      const shared = {
        provider: provider(value.provider),
        token,
        baseUrl: value.baseUrl,
        question: question(value.question),
        signal: controller.signal,
      }
      controller.signal.throwIfAborted()
      if (path === '/api/search/search') {
        if (
          typeof value.maxResults !== 'number' ||
          !Number.isInteger(value.maxResults) ||
          value.maxResults < 1 ||
          value.maxResults > 10
        ) {
          throw new SearchProviderError(400, 'maxResults must be an integer from 1 to 10.')
        }
        const results = await executeSearch({
          ...shared,
          query: query(value.query),
          maxResults: value.maxResults,
        })
        json(response, 200, { results })
      } else {
        if (typeof value.url !== 'string' || value.url.length > 8192) {
          throw new SearchProviderError(400, 'Invalid webpage URL.')
        }
        const document = await executeFetch({ ...shared, url: normalizeFetchUrl(value.url) })
        json(response, 200, { document })
      }
    }
    void run()
      .catch((error: unknown) => {
        if (controller.signal.aborted || response.destroyed || response.writableEnded) {
          return
        }
        const status = error instanceof SearchProviderError ? error.status : 502
        const message =
          error instanceof SearchProviderError
            ? error.message
            : 'The search service request failed.'
        json(response, status, {
          error: { message: token ? message.replaceAll(token, '[redacted]') : message },
        })
      })
      .finally(() => response.removeListener('close', abort))
  }
}
