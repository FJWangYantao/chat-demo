import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import {
  createModels,
  createProvider,
  lazyApi,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type ProviderStreams,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { ProxyAssistantMessageEvent } from '@earendil-works/pi-agent-core'
import {
  CUSTOM_PROVIDER,
  MAGPIE_PROVIDER,
  PROVIDER_APIS,
  type CatalogProvider,
  type ModelConfiguration,
} from '../src/services/api/providerTypes.ts'
import { magpieGatewayBaseUrl } from './magpie.ts'
import { isSameOriginAlias, isTrustedRequestOrigin } from './requestOrigin.ts'

const models = builtinModels()
const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])
const supportedApis = new Set<string>([...PROVIDER_APIS, 'mistral-conversations'])
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const catalog: CatalogProvider[] = models.getProviders().flatMap((provider) => {
  const available = provider.getModels().filter((model) => supportedApis.has(model.api))
  return provider.auth.apiKey && available.length > 0
    ? [
        {
          id: provider.id,
          name: provider.name,
          models: available.map((model) => ({
            id: model.id,
            name: model.name,
            provider: provider.id,
            api: model.api,
            baseUrl: model.baseUrl,
            reasoning: model.reasoning,
            imageInput: model.input.includes('image'),
          })),
        },
      ]
    : []
})

const customApis: Record<string, () => Promise<ProviderStreams>> = {
  'openai-completions': () => import('@earendil-works/pi-ai/api/openai-completions'),
  'openai-responses': () => import('@earendil-works/pi-ai/api/openai-responses'),
  'anthropic-messages': () => import('@earendil-works/pi-ai/api/anthropic-messages'),
  'google-generative-ai': () => import('@earendil-works/pi-ai/api/google-generative-ai'),
}

const readConfiguration = (value: unknown): ModelConfiguration => {
  if (
    !isRecord(value) ||
    typeof value.provider !== 'string' ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    value.id.length > 512 ||
    typeof value.baseUrl !== 'string' ||
    typeof value.api !== 'string' ||
    typeof value.reasoning !== 'boolean' ||
    !Array.isArray(value.input)
  ) {
    throw new Error('Invalid provider configuration.')
  }
  if (value.baseUrl) {
    const url = new URL(value.baseUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      throw new Error('Use an HTTPS API base URL, or HTTP on localhost.')
    }
  }
  return {
    provider: value.provider,
    model: value.id,
    baseUrl: value.baseUrl,
    api: value.api,
    reasoning: value.reasoning,
    imageInput: value.input.includes('image'),
  }
}

const resolveModel = (configuration: ModelConfiguration) => {
  if ([CUSTOM_PROVIDER, MAGPIE_PROVIDER].includes(configuration.provider)) {
    if (!configuration.baseUrl || !Object.hasOwn(customApis, configuration.api)) {
      throw new Error('Select a supported API and provide its base URL.')
    }
    if (
      configuration.provider === MAGPIE_PROVIDER &&
      configuration.baseUrl !== magpieGatewayBaseUrl()
    ) {
      throw new Error('Use the local Magpie gateway configured by this application server.')
    }
    const model: Model<Api> = {
      id: configuration.model,
      name: configuration.model,
      provider: configuration.provider,
      api: configuration.api,
      baseUrl: configuration.baseUrl,
      reasoning: configuration.reasoning,
      input: configuration.imageInput ? ['text', 'image'] : ['text'],
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    const runtime = createModels()
    runtime.setProvider(
      createProvider({
        id: configuration.provider,
        models: [model],
        auth: { apiKey: { name: 'Custom API key', resolve: async () => ({ auth: {} }) } },
        api: lazyApi(customApis[configuration.api]),
      })
    )
    return { model, runtime }
  }
  if (!catalog.some((item) => item.id === configuration.provider)) {
    throw new Error('This provider is not supported by API key authentication.')
  }
  const known = models.getModel(configuration.provider, configuration.model)
  const template =
    known ??
    models.getModels(configuration.provider).find((model) => model.api === configuration.api)
  if (!template || !supportedApis.has(template.api)) {
    throw new Error('Select a supported model API.')
  }
  const model: Model<Api> = {
    ...template,
    id: configuration.model,
    ...(known
      ? {}
      : {
          name: configuration.model,
          reasoning: configuration.reasoning,
          input: configuration.imageInput ? ['text', 'image'] : ['text'],
        }),
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
  }
  if (/\{[^}]+\}/.test(model.baseUrl)) {
    throw new Error('This provider requires a custom API base URL.')
  }
  return { model, runtime: models }
}

export const validateProviderConfiguration = (value: unknown): ModelConfiguration => {
  const configuration = readConfiguration(value)
  resolveModel(configuration)
  return configuration
}

export const completeProviderSimple = async (options: {
  configuration: unknown
  apiKey: string
  context: Context
  signal?: AbortSignal
  maxTokens?: number
  sessionId?: string
  reasoning?: boolean
  fetchImpl?: typeof fetch
}): Promise<AssistantMessage> => {
  const configuration = readConfiguration(options.configuration)
  const { model, runtime } = resolveModel(configuration)
  const message = await runtime.completeSimple(model, options.context, {
    apiKey: options.apiKey,
    signal: options.signal,
    maxRetries: 0,
    transport: 'sse',
    timeoutMs: 120000,
    maxTokens:
      typeof options.maxTokens === 'number' &&
      Number.isInteger(options.maxTokens) &&
      options.maxTokens > 0
        ? Math.min(options.maxTokens, model.maxTokens, 16384)
        : Math.min(model.maxTokens, 16384),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.reasoning && model.reasoning ? { reasoning: 'medium' as const } : {}),
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  })
  if (message.stopReason === 'error') {
    const detail = message.errorMessage ?? 'Provider request failed.'
    throw new Error(options.apiKey ? detail.replaceAll(options.apiKey, '[redacted]') : detail)
  }
  return message
}

const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 50 * 1024 * 1024) {
        reject(new Error('Request exceeds 50 MiB.'))
      } else {
        chunks.push(new Uint8Array(chunk))
      }
    })
    request.on('error', reject)
    request.on('end', () => {
      if (size > 50 * 1024 * 1024) {
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new Error('Invalid JSON request.'))
      }
    })
  })

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

export const createPiProviderMiddleware = (
  appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:8090'
) => {
  const origin = new URL(appOrigin)
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = new URL(request.url ?? '/', origin).pathname
    if (!path.startsWith('/api/ai/')) {
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
      json(response, 403, { error: 'Untrusted request origin.' })
      return
    }
    if (request.method === 'GET' && path === '/api/ai/providers') {
      if (request.headers['x-chat-demo-request'] !== '1') {
        json(response, 403, { error: 'Missing application request header.' })
        return
      }
      json(response, 200, { providers: catalog })
      return
    }
    if (request.method !== 'POST' || path !== '/api/ai/api/stream') {
      json(response, 404, { error: 'Unknown provider endpoint.' })
      return
    }
    if (
      !isSameOriginAlias(origin, request.headers.origin) ||
      !request.headers['content-type']?.includes('application/json')
    ) {
      json(response, 403, { error: 'Use the application to send provider requests.' })
      return
    }
    const controller = new AbortController()
    const apiKey = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    const redact = (message: string) =>
      apiKey ? message.replaceAll(apiKey, '[redacted]') : message
    const abort = () => {
      if (!response.writableEnded) {
        controller.abort()
      }
    }
    response.once('close', abort)
    const send = async (event: ProxyAssistantMessageEvent) => {
      controller.signal.throwIfAborted()
      if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) {
        await once(response, 'drain', { signal: controller.signal })
      }
    }
    const run = async () => {
      const value = await readBody(request)
      if (!isRecord(value) || !isRecord(value.context) || !Array.isArray(value.context.messages)) {
        throw new Error('Invalid agent transcript.')
      }
      const configuration = readConfiguration(value.model)
      if (
        !apiKey ||
        (apiKey === 'local' && ![CUSTOM_PROVIDER, MAGPIE_PROVIDER].includes(configuration.provider))
      ) {
        json(response, 401, { error: 'Configure an API key for this provider.' })
        return
      }
      if (configuration.provider === MAGPIE_PROVIDER && !localHostnames.has(origin.hostname)) {
        throw new Error('Magpie connections require a local application server.')
      }
      const { model, runtime } = resolveModel(configuration)
      const context = value.context as unknown as TranscriptContext
      const options = isRecord(value.options) ? value.options : {}
      controller.signal.throwIfAborted()
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      })
      const stream = runtime.streamSimple(model, context, {
        apiKey,
        signal: controller.signal,
        maxRetries: 0,
        transport: 'sse',
        timeoutMs: 120000,
        maxTokens:
          typeof options.maxTokens === 'number' &&
          Number.isInteger(options.maxTokens) &&
          options.maxTokens > 0
            ? Math.min(options.maxTokens, model.maxTokens, 16384)
            : Math.min(model.maxTokens, 16384),
        ...(typeof options.sessionId === 'string' ? { sessionId: options.sessionId } : {}),
        ...(options.reasoning && model.reasoning ? { reasoning: 'medium' as const } : {}),
      })
      for await (const event of stream) {
        controller.signal.throwIfAborted()
        if (event.type === 'start') {
          await send({ type: 'start' })
        } else if (event.type === 'text_start' || event.type === 'thinking_start') {
          await send({ type: event.type, contentIndex: event.contentIndex })
        } else if (
          event.type === 'text_delta' ||
          event.type === 'thinking_delta' ||
          event.type === 'toolcall_delta'
        ) {
          await send({ type: event.type, contentIndex: event.contentIndex, delta: event.delta })
        } else if (event.type === 'text_end' || event.type === 'thinking_end') {
          const part = event.partial.content[event.contentIndex]
          const signature =
            part?.type === 'thinking'
              ? part.thinkingSignature
              : part?.type === 'text'
                ? part.textSignature
                : undefined
          await send({
            type: event.type,
            contentIndex: event.contentIndex,
            contentSignature: signature,
          })
        } else if (event.type === 'toolcall_start') {
          const call = event.partial.content[event.contentIndex]
          if (call?.type !== 'toolCall') {
            throw new Error('Invalid streamed tool call.')
          }
          await send({
            type: 'toolcall_start',
            contentIndex: event.contentIndex,
            id: call.id,
            toolName: call.name,
          })
        } else if (event.type === 'toolcall_end') {
          await send({
            type: 'toolcall_end',
            contentIndex: event.contentIndex,
            toolCall: event.toolCall,
          })
        } else if (event.type === 'done') {
          if (event.reason === 'deferred') {
            throw new Error('Deferred requests are not supported.')
          }
          await send({
            type: 'done',
            reason: event.reason,
            usage: event.message.usage,
            providerThinkingLevel: event.message.providerThinkingLevel,
          })
        } else if (event.type === 'error') {
          await send({
            type: 'error',
            reason: event.reason,
            errorMessage: redact(event.error.errorMessage ?? 'Provider request failed.'),
            usage: event.error.usage,
          })
        }
      }
      response.end()
    }
    void run()
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || response.destroyed) {
          return
        }
        const message = redact(error instanceof Error ? error.message : 'Provider request failed.')
        if (!response.headersSent) {
          json(response, 400, { error: message })
        } else {
          await send({
            type: 'error',
            reason: 'error',
            errorMessage: message,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          }).catch(() => {})
          response.end()
        }
      })
      .finally(() => response.removeListener('close', abort))
  }
}
