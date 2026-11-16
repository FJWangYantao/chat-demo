import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  MAGPIE_BASE_URL,
  MAGPIE_LOCAL_KEY,
  MAGPIE_PROVIDER,
  type CatalogModel,
} from '../src/services/api/providerTypes.ts'
import { isLocalHostname, isTrustedRequestOrigin } from './requestOrigin.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const magpieGatewayBaseUrl = () =>
  (process.env.MAGPIE_BASE_URL || MAGPIE_BASE_URL).trim().replace(/\/+$/, '')

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const readModels = (value: unknown, baseUrl: string): CatalogModel[] => {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('magpie_invalid_response')
  }
  const ids = new Set<string>()
  return value.data.flatMap((item): CatalogModel[] => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      item.id.length > 512 ||
      (item.kind !== undefined && item.kind !== 'chat')
    ) {
      return []
    }
    const id = item.id.trim()
    if (ids.has(id)) {
      return []
    }
    ids.add(id)
    const label = [item.magpie_label, item.display_name, item.name].find(
      (candidate) => typeof candidate === 'string' && candidate.trim()
    )
    const modalities = isRecord(item.modalities) ? item.modalities : null
    const input = modalities && Array.isArray(modalities.input) ? modalities.input : []
    return [
      {
        id,
        name: typeof label === 'string' ? label.trim().slice(0, 512) || id : id,
        provider: MAGPIE_PROVIDER,
        api: 'openai-completions',
        baseUrl,
        reasoning: item.reasoning === true,
        imageInput: input.includes('image'),
      },
    ]
  })
}

export const createMagpieMiddleware = (
  appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:8090'
) => {
  const origin = new URL(appOrigin)
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = new URL(request.url ?? '/', origin).pathname
    if (!path.startsWith('/api/magpie/')) {
      next()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    if (
      !isTrustedRequestOrigin(request, origin) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      json(response, 403, { error: 'untrusted_request_origin' })
      return
    }
    if (request.method !== 'GET' || path !== '/api/magpie/models') {
      json(response, 404, { error: 'unknown_magpie_endpoint' })
      return
    }
    if (request.headers['x-chat-demo-request'] !== '1') {
      json(response, 403, { error: 'missing_application_request_header' })
      return
    }
    if (!isLocalHostname(origin.hostname)) {
      json(response, 403, { error: 'magpie_local_only' })
      return
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timeout = setTimeout(abort, 5000)
    response.once('close', abort)
    const run = async () => {
      try {
        const baseUrl = magpieGatewayBaseUrl()
        const upstream = await fetch(`${baseUrl}/models`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${MAGPIE_LOCAL_KEY}` },
          redirect: 'error',
          signal: controller.signal,
        })
        if (!upstream.ok) {
          await upstream.body?.cancel()
          throw new Error(
            upstream.status === 401 || upstream.status === 403
              ? 'magpie_unauthorized'
              : 'magpie_gateway_error'
          )
        }
        const text = await upstream.text()
        if (
          text.length > 4 * 1024 * 1024 ||
          !upstream.headers.get('Content-Type')?.includes('application/json')
        ) {
          throw new Error('magpie_invalid_response')
        }
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          throw new Error('magpie_invalid_response')
        }
        controller.signal.throwIfAborted()
        json(response, 200, { baseUrl, models: readModels(body, baseUrl) })
      } catch (error) {
        if (response.destroyed) {
          return
        }
        const code =
          error instanceof Error &&
          ['magpie_unauthorized', 'magpie_gateway_error', 'magpie_invalid_response'].includes(
            error.message
          )
            ? error.message
            : 'magpie_unavailable'
        json(
          response,
          code === 'magpie_unauthorized' ? 401 : code === 'magpie_unavailable' ? 503 : 502,
          {
            error: code,
          }
        )
      } finally {
        clearTimeout(timeout)
        response.removeListener('close', abort)
      }
    }
    void run()
  }
}
