import { translate } from '../../i18n/index.js'
import type { ToolCallPart } from '../chat/types.js'
import { waitForToolApproval } from './approvals.js'
import { executeGitHubCall, isGitHubWriteTool, useGitHub, validateGitHubCall } from './github.js'

export const CLIENT_TOOL_CONCURRENCY = 50
export const TOOL_ROUND_LIMIT = 8
export const TOOL_CALL_LIMIT = TOOL_ROUND_LIMIT * CLIENT_TOOL_CONCURRENCY

export const runClientTool = async (
  call: ToolCallPart,
  sessionId: string,
  messageId: string,
  signal: AbortSignal,
  update: (call: ToolCallPart) => void
): Promise<void> => {
  const finish = (status: ToolCallPart['status'], content: string, isError = false) =>
    update({
      ...call,
      status,
      result: { type: 'tool_result', tool_use_id: call.id, content, is_error: isError },
    })
  try {
    signal.throwIfAborted()
    if (call.inputJson !== undefined) {
      throw new Error(translate('githubInvalidArguments'))
    }
    validateGitHubCall(call.name, call.input)
    const connection = useGitHub.getState().connection
    if (!connection) {
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
    if (useGitHub.getState().connection !== connection) {
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
    finish('error', error instanceof Error ? error.message : translate('unknownError'), true)
  }
}

export const runClientTools = async (
  calls: ToolCallPart[],
  sessionId: string,
  messageId: string,
  signal: AbortSignal,
  update: (call: ToolCallPart, index: number) => void
): Promise<void> => {
  const run = (index: number) =>
    runClientTool(calls[index], sessionId, messageId, signal, (call) => update(call, index))
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
    let next = start
    const worker = async () => {
      while (next < end) {
        signal.throwIfAborted()
        const index = next++
        await run(index)
      }
    }
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(CLIENT_TOOL_CONCURRENCY, end - start) }, worker)
    )
    signal.throwIfAborted()
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
    start = end
  }
}
