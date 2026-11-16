export type StoredConnection = {
  id: string
  browserId: string
  token: string
  accountId: string
  userId?: string
  baseUrl: string
  connectedAt: string
}

export type ConversationEntry = {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

export type WeChatAIStatus = {
  configured: boolean
  model: string
  error?: string
}

export type WeChatAI = {
  status: () => WeChatAIStatus
  complete: (options: {
    messages: ConversationEntry[]
    sessionId: string
    signal: AbortSignal
  }) => Promise<string>
}
