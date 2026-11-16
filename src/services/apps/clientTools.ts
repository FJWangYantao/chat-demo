import { translate } from '../../i18n/index.js'
import type { ToolCallPart } from '../chat/types.js'
import { describeSearchError } from '../search/client.js'
import {
  createSearchExecutionContext,
  executeSearchTool,
  type SearchExecutionContext,
} from '../search/execute.js'
import { SEARCH_ROUND_CONTENT_LIMIT } from '../search/sources.js'
import { isSearchTool } from '../search/tools.js'
import { waitForToolApproval } from './approvals.js'
import { executeGitHubCall, isGitHubWriteTool, validateGitHubCall } from './github.js'
import { getGitHubConnection, useGitHub } from './githubConnection.js'

export const CLIENT_TOOL_CONCURRENCY = 50
export const SEARCH_TOOL_CONCURRENCY = 4
export const TOOL_ROUND_LIMIT = 8
export const TOOL_CALL_LIMIT = TOOL_ROUND_LIMIT * CLIENT_TOOL_CONCURRENCY

export { createSearchExecutionContext }
export type { SearchExecutionContext }

export const runClientTool = async (
  call: ToolCallPart,
  sessionId: string,
  messageId: string,
  signal: AbortSignal,
  update: (call: ToolCallPart) => void,
  connection = getGitHubConnection(),
  revision = useGitHub.getState().revision,
  searchContext: SearchExecutionContext = createSearchExecutionContext(null, '')
): Promise<void> => {
  const finish = (status: ToolCallPart['status'], content: string, isError = false) =>
    update({
      ...call,
      status,
      result: { type: 'tool_result', tool_use_id: call.id, content, is_error: isError },
    })
  const search = isSearchTool(call.name)
  try {
    signal.throwIfAborted()
    if (call.inputJson !== undefined) {
      throw new Error(translate(search ? 'searchInvalidArguments' : 'githubInvalidArguments'))
    }
    if (search) {
      update({ ...call, status: 'running' })
      finish('done', await executeSearchTool(call, searchContext, signal))
      return
    }
    validateGitHubCall(call.name, call.input)
    if (!connection || useGitHub.getState().revision !== revision) {
      throw new Error(translate('githubDisconnected'))
    }
    if (isGitHubWriteTool(call.name)) {
      const approval = waitForToolApproval(sessionId, messageId, call.id, signal)
      update({ ...call, status: 'approval' })
      if (!(await approval)) {
        finish('cancelled', translate('appToolDenied'), true)
        return
      }
    }
    signal.throwIfAborted()
    const current = getGitHubConnection()
    if (
      current?.id !== connection.id ||
      current.token !== connection.token ||
      useGitHub.getState().revision !== revision
    ) {
      throw new Error(translate('githubDisconnected'))
    }
    update({ ...call, status: 'running' })
    const result = await executeGitHubCall(
      call.name,
      call.input,
      signal,
      isGitHubWriteTool(call.name)
    )
    finish('done', result)
  } catch (error) {
    signal.throwIfAborted()
    finish(
      'error',
      search
        ? describeSearchError(error)
        : error instanceof Error
          ? error.message
          : translate('unknownError'),
      true
    )
  }
}

export const runClientTools = async (
  calls: ToolCallPart[],
  sessionId: string,
  messageId: string,
  signal: AbortSignal,
  update: (call: ToolCallPart, index: number) => void,
  searchContext: SearchExecutionContext = createSearchExecutionContext(null, '')
): Promise<void> => {
  const connection = getGitHubConnection()
  const revision = useGitHub.getState().revision
  searchContext.roundCalls = 0
  searchContext.roundContent = SEARCH_ROUND_CONTENT_LIMIT
  const run = (index: number) =>
    runClientTool(
      calls[index],
      sessionId,
      messageId,
      signal,
      (call) => update(call, index),
      connection,
      revision,
      searchContext
    )
  const runPool = async (indexes: number[], concurrency: number) => {
    let next = 0
    const worker = async () => {
      while (next < indexes.length) {
        signal.throwIfAborted()
        await run(indexes[next++])
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, indexes.length) }, worker))
  }
  let start = 0
  while (start < calls.length) {
    signal.throwIfAborted()
    if (isGitHubWriteTool(calls[start].name)) {
      await run(start)
      start += 1
      continue
    }
    let end = start + 1
    while (end < calls.length && !isGitHubWriteTool(calls[end].name)) {
      end += 1
    }
    const indexes = Array.from({ length: end - start }, (_, index) => start + index)
    const results = await Promise.allSettled([
      runPool(
        indexes.filter((index) => !isSearchTool(calls[index].name)),
        CLIENT_TOOL_CONCURRENCY
      ),
      runPool(
        indexes.filter((index) => isSearchTool(calls[index].name)),
        SEARCH_TOOL_CONCURRENCY
      ),
    ])
    signal.throwIfAborted()
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
    start = end
  }
}
