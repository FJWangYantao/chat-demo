const pending = new Map<string, (approved: boolean) => void>()

const key = (sessionId: string, messageId: string, toolId: string) =>
  JSON.stringify([sessionId, messageId, toolId])

export const approveToolCall = (
  sessionId: string,
  messageId: string,
  toolId: string,
  approved: boolean
) => pending.get(key(sessionId, messageId, toolId))?.(approved)

export const waitForToolApproval = (
  sessionId: string,
  messageId: string,
  toolId: string,
  signal: AbortSignal
): Promise<boolean> => {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const id = key(sessionId, messageId, toolId)
    const cleanup = () => {
      pending.delete(id)
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    pending.set(id, (approved) => {
      cleanup()
      resolve(approved)
    })
    signal.addEventListener('abort', abort, { once: true })
  })
}

export const cancelToolApprovals = () => {
  for (const resolve of [...pending.values()]) {
    resolve(false)
  }
}
