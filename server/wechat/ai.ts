import type { Context } from '@earendil-works/pi-ai'
import { completeProviderSimple, validateProviderConfiguration } from '../piProvider.ts'
import type { WeChatAI } from './types.ts'

const DEFAULT_SYSTEM_PROMPT = `你是 chat-demo 在微信中的 AI 助手。请使用简洁、清晰的纯文本回答，不使用表格、图片或复杂 Markdown。当前无法访问网页聊天记录、GitHub、搜索、本地文件或其他工具，不要声称已经执行这些操作。回答应直接解决用户问题；信息不足时明确说明。`

const toContextMessage = (
  message: { role: 'user' | 'assistant'; text: string; timestamp: number },
  api: string,
  provider: string,
  model: string
): Context['messages'][number] =>
  message.role === 'user'
    ? { role: 'user', content: message.text, timestamp: message.timestamp }
    : {
        role: 'assistant',
        content: [{ type: 'text', text: message.text }],
        api,
        provider,
        model,
        stopReason: 'stop',
        timestamp: message.timestamp,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }

export const createWeChatAI = (
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): WeChatAI => {
  const provider = env.WECHAT_AI_PROVIDER?.trim() || 'deepseek'
  const model = env.WECHAT_AI_MODEL?.trim() || 'deepseek-flash'
  const apiKey = env.WECHAT_AI_API_KEY?.trim() || ''
  const modelLabel = `${provider}/${model}`
  const configuration = {
    provider,
    id: model,
    baseUrl: env.WECHAT_AI_BASE_URL?.trim() || '',
    api: env.WECHAT_AI_API?.trim() || 'openai-completions',
    reasoning: env.WECHAT_AI_REASONING === '1',
    imageInput: false,
    input: ['text'],
  }
  const maxTokens = Math.min(
    8192,
    Math.max(256, Number.parseInt(env.WECHAT_AI_MAX_TOKENS ?? '2048', 10) || 2048)
  )
  const systemPrompt = env.WECHAT_AI_SYSTEM_PROMPT?.trim().slice(0, 8000) || DEFAULT_SYSTEM_PROMPT
  let configurationError: string | undefined
  if (!apiKey) {
    configurationError = 'missing_api_key'
  } else {
    try {
      validateProviderConfiguration(configuration)
    } catch {
      configurationError = 'invalid_configuration'
    }
  }

  return {
    status: () => ({
      configured: !configurationError,
      model: modelLabel,
      error: configurationError,
    }),
    complete: async ({ messages, sessionId, signal }) => {
      if (configurationError) {
        throw new Error(`wechat_ai_${configurationError}`)
      }
      const context: Context = {
        systemPrompt,
        messages: messages.map((message) =>
          toContextMessage(message, configuration.api, provider, model)
        ),
      }
      const result = await completeProviderSimple({
        configuration,
        apiKey,
        context,
        signal,
        maxTokens,
        sessionId,
        reasoning: configuration.reasoning,
        fetchImpl,
      })
      if (signal.aborted) {
        throw new Error('wechat_ai_aborted')
      }
      const text = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (!text) {
        throw new Error('wechat_ai_empty_response')
      }
      return text
    },
  }
}
