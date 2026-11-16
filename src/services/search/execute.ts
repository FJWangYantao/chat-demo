import { translate } from '../../i18n/index.js'
import type { ToolCallPart } from '../chat/types.js'
import { fetchWeb, searchWeb } from './client.js'
import { ReplySourceRegistry, SEARCH_ROUND_CONTENT_LIMIT, searchToolPayload } from './sources.js'
import type { SearchConfig } from './types.js'

export const SEARCH_ROUND_CALL_LIMIT = 4
export const SEARCH_REPLY_CALL_LIMIT = 12

export type SearchExecutionContext = {
  config: SearchConfig | null
  question: string
  registry: ReplySourceRegistry
  totalCalls: number
  roundCalls: number
  roundContent: number
}

export const createSearchExecutionContext = (
  config: SearchConfig | null,
  question: string,
  registry = new ReplySourceRegistry()
): SearchExecutionContext => ({
  config,
  question,
  registry,
  totalCalls: 0,
  roundCalls: 0,
  roundContent: SEARCH_ROUND_CONTENT_LIMIT,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const input = (call: ToolCallPart, keys: string[]): Record<string, unknown> => {
  const value = call.input
  if (
    !isRecord(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(translate('searchInvalidArguments'))
  }
  return value
}

const query = (call: ToolCallPart): string => {
  const value = input(call, ['query']).query
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 128) {
    throw new Error(translate('searchInvalidArguments'))
  }
  return value.trim()
}

const url = (call: ToolCallPart): string => {
  const value = input(call, ['url']).url
  if (typeof value !== 'string' || value.length > 8192) {
    throw new Error(translate('searchInvalidArguments'))
  }
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error()
    }
    return parsed.href
  } catch {
    throw new Error(translate('searchInvalidArguments'))
  }
}

const prepare = (context: SearchExecutionContext) => {
  if (!context.config) {
    throw new Error(translate('searchNotConfigured'))
  }
  if (
    context.roundCalls >= SEARCH_ROUND_CALL_LIMIT ||
    context.totalCalls >= SEARCH_REPLY_CALL_LIMIT
  ) {
    throw new Error(translate('searchCallLimit'))
  }
  context.roundCalls += 1
  context.totalCalls += 1
  return context.config
}

export const executeSearchTool = async (
  call: ToolCallPart,
  context: SearchExecutionContext,
  signal: AbortSignal
): Promise<string> => {
  if (call.name === 'web_search') {
    const searchQuery = query(call)
    const config = prepare(context)
    const results = await searchWeb(config, searchQuery, context.question, signal)
    const sources = context.registry.addSearch(results, context.roundContent)
    context.roundContent = Math.max(
      0,
      context.roundContent - sources.reduce((total, source) => total + source.content.length, 0)
    )
    return searchToolPayload('web_search', sources)
  }
  if (call.name === 'web_fetch') {
    const fetchUrl = url(call)
    const config = prepare(context)
    const document = await fetchWeb(config, fetchUrl, context.question, signal)
    const source = context.registry.addFetch(document, context.roundContent)
    context.roundContent = Math.max(0, context.roundContent - source.content.length)
    return searchToolPayload('web_fetch', [source])
  }
  throw new Error(translate('searchInvalidArguments'))
}
