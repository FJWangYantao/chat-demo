import { Agent, streamProxy, type AgentTool } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage as PiMessage, Model } from '@earendil-works/pi-ai'
import { translate } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { toPiContext } from '../api/piContext.js'
import { inlineProviderFiles } from '../api/piFiles.js'
import type { MessageParam, MessageStreamEvent } from '../api/types.js'
import type { ModelConfiguration } from '../api/providerTypes.js'
import { getGitHubTools } from '../apps/github.js'
import {
  TOOL_CALL_LIMIT,
  TOOL_ROUND_LIMIT,
  runClientTools,
  type SearchExecutionContext,
} from '../apps/clientTools.js'
import { getSearchTools, isSearchTool } from '../search/tools.js'
import type { ToolCallPart } from './types.js'

type AgentOptions = {
  configuration: ModelConfiguration
  apiKey: string
  sessionId: string
  messageId: string
  system: string
  messages: MessageParam[]
  thinking: boolean
  signal: AbortSignal
  emit: (event: MessageStreamEvent) => void
  onMessage: (message: PiMessage) => void
  onTool: (call: ToolCallPart) => void
  searchContext: SearchExecutionContext
}

export const createPiModel = (configuration: ModelConfiguration): Model<Api> => ({
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
})

export const runPiAgent = async (options: AgentOptions): Promise<void> => {
  const { configuration, signal, emit } = options
  const model = createPiModel(configuration)
  const messages = await inlineProviderFiles(options.messages, signal)
  signal.throwIfAborted()
  const context = toPiContext(messages, options.system, model)
  const definitions =
    configuration.toolCalling === false
      ? []
      : [
          ...getGitHubTools(),
          ...(options.searchContext.config?.mode === 'agent' ? getSearchTools() : []),
        ]
  let calls: ToolCallPart[] = []
  let batch: Promise<void> | undefined
  let totalCalls = 0
  let rounds = 0
  let failure: Error | undefined
  const ids = new Set<string>()
  const toolResults = new Map<string, ToolCallPart>()
  const tools: AgentTool[] = definitions.map((definition) => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: definition.input_schema,
    execute: async (id) => {
      if (failure) {
        throw failure
      }
      batch ??= runClientTools(
        calls,
        options.sessionId,
        options.messageId,
        signal,
        (call) => {
          toolResults.set(call.id, call)
          options.onTool(call)
        },
        options.searchContext
      )
      await batch
      signal.throwIfAborted()
      const result = toolResults.get(id)?.result
      if (!result) {
        throw new Error(translate('githubInvalidResponse'))
      }
      return {
        content: [{ type: 'text', text: result.content }],
        details: undefined,
        isError: result.is_error,
      }
    },
  }))
  const agent = new Agent({
    initialState: {
      systemPrompt: context.systemPrompt,
      model,
      messages: context.messages,
      tools,
      thinkingLevel: options.thinking && configuration.reasoning ? 'medium' : 'off',
    },
    sessionId: options.sessionId,
    toolExecution: 'parallel',
    identity: { attribution: null },
    streamFn: (selected, transcript, streamOptions) =>
      streamProxy(selected, transcript, {
        ...streamOptions,
        signal: streamOptions?.signal,
        authToken: options.apiKey || 'local',
        proxyUrl: '/api/ai',
        transport: 'sse',
      }),
    beforeToolCall: async () =>
      failure ? { block: true, reason: failure.message, terminate: true } : undefined,
    finishTurn: () => (failure ? { action: 'end' } : undefined),
  })
  const abort = () => agent.abort()
  signal.addEventListener('abort', abort, { once: true })
  let blockStarts = new Set<number>()
  agent.subscribe((event) => {
    if (signal.aborted) {
      return
    }
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      blockStarts = new Set()
      calls = []
      batch = undefined
      emit({
        type: 'message_start',
        message: { id: crypto.randomUUID(), model: configuration.model },
      })
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_start' || update.type === 'thinking_start') {
        blockStarts.add(update.contentIndex)
        emit({
          type: 'content_block_start',
          index: update.contentIndex,
          content_block:
            update.type === 'text_start'
              ? { type: 'text', text: '' }
              : { type: 'thinking', thinking: '', signature: '' },
        })
      } else if (update.type === 'text_delta' || update.type === 'thinking_delta') {
        emit({
          type: 'content_block_delta',
          index: update.contentIndex,
          delta:
            update.type === 'text_delta'
              ? { type: 'text_delta', text: update.delta }
              : { type: 'thinking_delta', thinking: update.delta },
        })
      } else if (update.type === 'text_end' || update.type === 'thinking_end') {
        emit({ type: 'content_block_stop', index: update.contentIndex })
      } else if (update.type === 'toolcall_start') {
        const call = update.partial.content[update.contentIndex]
        if (call?.type === 'toolCall') {
          blockStarts.add(update.contentIndex)
          emit({
            type: 'content_block_start',
            index: update.contentIndex,
            content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} },
          })
        }
      } else if (update.type === 'toolcall_end') {
        const call = update.toolCall
        if (!blockStarts.has(update.contentIndex)) {
          blockStarts.add(update.contentIndex)
          emit({
            type: 'content_block_start',
            index: update.contentIndex,
            content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} },
          })
        }
        emit({
          type: 'content_block_delta',
          index: update.contentIndex,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.arguments) },
        })
        emit({ type: 'content_block_stop', index: update.contentIndex })
      }
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message
      calls = message.content.flatMap((part): ToolCallPart[] =>
        part.type === 'toolCall'
          ? [
              {
                type: 'tool_use',
                id: part.id,
                name: part.name,
                input: part.arguments,
                status: 'pending',
              },
            ]
          : []
      )
      if (calls.length > 0) {
        rounds += 1
        totalCalls += calls.filter((call) => !isSearchTool(call.name)).length
        if (rounds > TOOL_ROUND_LIMIT || totalCalls > TOOL_CALL_LIMIT) {
          failure = new Error(translate('appToolRoundLimit'))
        }
        for (const call of calls) {
          if (ids.has(call.id) || !definitions.some((tool) => tool.name === call.name)) {
            failure = new Error(translate('githubInvalidResponse'))
          }
          ids.add(call.id)
        }
      }
      options.onMessage(structuredClone(message))
      emit({
        type: 'message_delta',
        delta: {
          stop_reason:
            message.stopReason === 'toolUse'
              ? 'tool_use'
              : message.stopReason === 'length'
                ? 'max_tokens'
                : 'end_turn',
          stop_sequence: null,
        },
        usage: {
          input_tokens: message.usage.input,
          output_tokens: message.usage.output,
          cache_creation_input_tokens: message.usage.cacheWrite,
          cache_read_input_tokens: message.usage.cacheRead,
        },
      })
    } else if (event.type === 'tool_execution_end' && !toolResults.has(event.toolCallId)) {
      const call = calls.find((item) => item.id === event.toolCallId)
      if (call) {
        options.onTool({
          ...call,
          status: event.isError ? 'error' : 'done',
          result: {
            type: 'tool_result',
            tool_use_id: call.id,
            content: event.result.content
              .map((part: { type: string; text?: string }) => part.text ?? '')
              .join('\n'),
            is_error: event.isError,
          },
        })
      }
    }
  })
  try {
    signal.throwIfAborted()
    if (context.messages.at(-1)?.role === 'assistant') {
      await agent.prompt({
        role: 'user',
        content:
          'Continue the previous response from where it stopped without repeating existing text.',
        timestamp: Date.now(),
      })
    } else {
      await agent.continue()
    }
    signal.throwIfAborted()
    if (failure) {
      throw failure
    }
    const last = agent.state.messages.at(-1)
    if (
      last?.role === 'assistant' &&
      (last.stopReason === 'error' || last.stopReason === 'aborted')
    ) {
      throw new ApiError('stream', last.errorMessage ?? translate('providerRequestFailed'))
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await batch?.catch(() => {})
  }
}
