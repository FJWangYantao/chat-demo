import type { AssistantMessage, Context, Message, Model, Api, Usage } from '@earendil-works/pi-ai'
import type { MessageParam } from './types.js'

export const emptyPiUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})

export const toPiContext = (
  input: MessageParam[],
  systemPrompt: string,
  model: Model<Api>
): Context => {
  const messages: Message[] = []
  const toolNames = new Map<string, string>()
  let reminder = ''
  for (const message of input) {
    if (message.role === 'latest_reminder') {
      reminder = message.content
      continue
    }
    if (message.role === 'assistant') {
      if (message.providerMessage) {
        for (const part of message.providerMessage.content) {
          if (part.type === 'toolCall') {
            toolNames.set(part.id, part.name)
          }
        }
        messages.push(message.providerMessage)
        continue
      }
      const content: AssistantMessage['content'] = []
      for (const block of message.content) {
        if (block.type === 'text') {
          content.push({ type: 'text', text: block.text })
        } else if (block.type === 'tool_use') {
          toolNames.set(block.id, block.name)
          content.push({
            type: 'toolCall',
            id: block.id,
            name: block.name,
            arguments: block.input as never,
          })
        }
      }
      if (content.length) {
        messages.push({
          role: 'assistant',
          content,
          provider: 'deepseek-native',
          api: 'anthropic-messages',
          model: 'deepseek-flash',
          usage: emptyPiUsage(),
          stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
          timestamp: Date.now(),
        })
      }
      continue
    }
    if (typeof message.content === 'string') {
      messages.push({ role: 'user', content: message.content, timestamp: Date.now() })
      continue
    }
    const content: Extract<Message, { role: 'user' }>['content'] & unknown[] = []
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        messages.push({
          role: 'toolResult',
          toolCallId: block.tool_use_id,
          toolName: toolNames.get(block.tool_use_id) ?? 'unknown',
          content: [{ type: 'text', text: block.content }],
          isError: block.is_error ?? false,
          timestamp: Date.now(),
        })
      } else if (block.type === 'text') {
        content.push({ type: 'text', text: block.text })
      } else if (block.type === 'image' && block.source.type === 'base64') {
        if (!model.input.includes('image')) {
          throw new Error('This model does not support image input.')
        }
        content.push({ type: 'image', data: block.source.data, mimeType: block.source.media_type })
      } else {
        throw new Error('A local attachment could not be prepared for this provider.')
      }
    }
    if (content.length) {
      messages.push({ role: 'user', content, timestamp: Date.now() })
    }
  }
  return {
    systemPrompt: `${systemPrompt}${reminder ? `\nCurrent context: ${reminder}` : ''}`,
    messages,
  }
}
