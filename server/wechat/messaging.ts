import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  getWeChatTypingTicket,
  getWeChatUpdates,
  notifyWeChat,
  sendWeChatText,
  sendWeChatTyping,
  WeChatApiError,
  type WeChatInboundMessage,
} from './ilink.ts'
import type { ConversationEntry, StoredConnection, WeChatAI } from './types.ts'

export type WeChatMessagingStatus = 'starting' | 'online' | 'retrying' | 'expired' | 'stopped'

type PersistedState = {
  cursor: string
  recentIds: string[]
  conversations: Record<string, ConversationEntry[]>
}

type Monitor = {
  connection: StoredConnection
  controller: AbortController
  file: string
  state: PersistedState
  status: WeChatMessagingStatus
  writes: Promise<void>
  done: Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const emptyState = (): PersistedState => ({
  cursor: '',
  recentIds: [],
  conversations: Object.create(null) as Record<string, ConversationEntry[]>,
})

const readState = (value: unknown): PersistedState => {
  const state = emptyState()
  if (!isRecord(value) || value.version !== 1) {
    return state
  }
  if (typeof value.cursor === 'string' && value.cursor.length <= 2 * 1024 * 1024) {
    state.cursor = value.cursor
  }
  if (Array.isArray(value.recentIds)) {
    state.recentIds = value.recentIds
      .filter((item): item is string => typeof item === 'string' && item.length <= 1100)
      .slice(-1000)
  }
  if (isRecord(value.conversations)) {
    for (const [sender, entries] of Object.entries(value.conversations).slice(0, 100)) {
      if (!Array.isArray(entries) || sender.length > 512) {
        continue
      }
      const history = entries.flatMap((entry): ConversationEntry[] =>
        isRecord(entry) &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.text === 'string' &&
        entry.text.length <= 50000 &&
        typeof entry.timestamp === 'number' &&
        Number.isFinite(entry.timestamp)
          ? [{ role: entry.role, text: entry.text, timestamp: entry.timestamp }]
          : []
      )
      if (history.length) {
        state.conversations[sender] = history.slice(-24)
      }
    }
  }
  return state
}

const splitReply = (text: string, limit = 3500) => {
  const chunks: string[] = []
  let offset = 0
  while (offset < text.length) {
    let end = Math.min(offset + limit, text.length)
    if (
      end < text.length &&
      /[\uD800-\uDBFF]/.test(text[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[end])
    ) {
      end -= 1
    }
    chunks.push(text.slice(offset, end))
    offset = end
  }
  return chunks.length ? chunks : ['（空回复）']
}

const trimHistory = (entries: ConversationEntry[]) => {
  const recent = entries.slice(-24)
  let size = recent.reduce((total, entry) => total + entry.text.length, 0)
  while (recent.length > 2 && size > 60000) {
    const removed = recent.splice(0, 2)
    size -= removed.reduce((total, entry) => total + entry.text.length, 0)
  }
  return recent
}

const messageText = (message: WeChatInboundMessage) => {
  let text = ''
  let hasMedia = false
  for (const item of message.item_list ?? []) {
    if (item.type === 1 && typeof item.text_item?.text === 'string' && !text) {
      text = item.text_item.text
    } else if (item.type === 3 && typeof item.voice_item?.text === 'string' && !text) {
      text = item.voice_item.text
    } else if ([2, 4, 5].includes(item.type ?? 0)) {
      hasMedia = true
    }
  }
  return { text: text.trim(), hasMedia }
}

const isStale = (error: unknown) => error instanceof WeChatApiError && error.code === -14

export const createWeChatMessaging = (options: {
  dataDir: string
  ai: WeChatAI
  allowFrom?: string
}) => {
  const monitors = new Map<string, Monitor>()
  const allowed = new Set(
    (options.allowFrom ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )

  const persist = (monitor: Monitor) => {
    monitor.writes = monitor.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(options.dataDir, { recursive: true, mode: 0o700 })
        const temporary = `${monitor.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
        await writeFile(temporary, JSON.stringify({ version: 1, ...monitor.state }, null, 2), {
          mode: 0o600,
        })
        await rename(temporary, monitor.file)
      })
    return monitor.writes
  }

  const reply = async (
    monitor: Monitor,
    message: WeChatInboundMessage,
    sender: string,
    text: string,
    messageKey?: string
  ) => {
    const chunks = splitReply(text)
    for (let index = 0; index < chunks.length; index++) {
      const seed = messageKey ?? `${sender}:${Date.now()}:${index}`
      const clientId = `chat-demo-${createHash('sha256').update(`${seed}:${index}`).digest('hex').slice(0, 24)}`
      await sendWeChatText(
        monitor.connection,
        {
          to: sender,
          text: chunks[index],
          contextToken: message.context_token,
          clientId,
        },
        monitor.controller.signal
      )
    }
  }

  const processMessage = async (monitor: Monitor, message: WeChatInboundMessage) => {
    const sender = typeof message.from_user_id === 'string' ? message.from_user_id : ''
    const messageId = typeof message.message_id === 'string' ? message.message_id : ''
    const messageKey = sender && messageId ? `${sender}:${messageId}` : undefined
    if (messageKey && monitor.state.recentIds.includes(messageKey)) {
      return
    }
    if (
      message.message_type === 1 &&
      sender &&
      sender.length <= 512 &&
      !message.group_id &&
      (allowed.has('*') ||
        allowed.has(sender) ||
        (!allowed.size && monitor.connection.userId === sender))
    ) {
      const { text, hasMedia } = messageText(message)
      if (text === '/clear' || text === '/new') {
        Reflect.deleteProperty(monitor.state.conversations, sender)
        await reply(monitor, message, sender, '已清空当前微信会话，可以开始新的提问。', messageKey)
      } else if (!text && hasMedia) {
        await reply(
          monitor,
          message,
          sender,
          '目前只支持文字和语音转文字，暂不支持图片、文件或视频。请改用文字描述。',
          messageKey
        )
      } else if (text) {
        if (!options.ai.status().configured) {
          await reply(
            monitor,
            message,
            sender,
            '微信 AI 尚未配置。请在应用服务端设置 WECHAT_AI_API_KEY 等环境变量并重启服务。',
            messageKey
          )
        } else {
          const input = text.length > 12000 ? `${text.slice(0, 12000)}\n（内容过长已截断）` : text
          let ticket = ''
          try {
            ticket = await getWeChatTypingTicket(
              monitor.connection,
              sender,
              message.context_token,
              monitor.controller.signal
            )
            if (ticket) {
              await sendWeChatTyping(
                monitor.connection,
                { userId: sender, ticket, typing: true },
                monitor.controller.signal
              )
            }
          } catch {
            ticket = ''
          }
          let answer: string | undefined
          let history: ConversationEntry[] = []
          let now = 0
          try {
            history = monitor.state.conversations[sender] ?? []
            now = Date.now()
            answer = await options.ai.complete({
              messages: [...history, { role: 'user', text: input, timestamp: now }],
              sessionId: `wechat-${createHash('sha256').update(`${monitor.connection.id}:${sender}`).digest('hex').slice(0, 32)}`,
              signal: monitor.controller.signal,
            })
          } catch (error) {
            if (monitor.controller.signal.aborted || isStale(error)) {
              throw error
            }
            process.stderr.write('[WeChat] AI reply failed.\n')
            await reply(
              monitor,
              message,
              sender,
              'AI 暂时无法回答，请稍后重试。若持续失败，请检查服务端模型配置与额度。',
              messageKey
            )
          } finally {
            if (ticket) {
              try {
                await sendWeChatTyping(
                  monitor.connection,
                  { userId: sender, ticket, typing: false },
                  AbortSignal.timeout(3000)
                )
              } catch {
                // 输入状态取消失败不影响消息结果。
              }
            }
          }
          if (answer) {
            await reply(monitor, message, sender, answer, messageKey)
            monitor.state.conversations[sender] = trimHistory([
              ...history,
              { role: 'user', text: input, timestamp: now },
              { role: 'assistant', text: answer, timestamp: Date.now() },
            ])
          }
        }
      }
    }
    if (messageKey) {
      monitor.state.recentIds = [...monitor.state.recentIds, messageKey].slice(-1000)
      await persist(monitor)
    }
  }

  const run = async (monitor: Monitor) => {
    const { signal } = monitor.controller
    let timeoutMs = 35000
    let retryDelay = 1000
    try {
      await notifyWeChat(monitor.connection, true, signal).catch(() => undefined)
      while (!signal.aborted) {
        try {
          const updates = await getWeChatUpdates(
            monitor.connection,
            monitor.state.cursor,
            timeoutMs,
            signal
          )
          if (updates.code === -14) {
            monitor.status = 'expired'
            return
          }
          if (updates.code !== 0) {
            throw new Error(`wechat_updates_${updates.code}`)
          }
          monitor.status = 'online'
          retryDelay = 1000
          timeoutMs = updates.nextTimeoutMs
          for (const message of updates.messages) {
            signal.throwIfAborted()
            await processMessage(monitor, message)
          }
          if (updates.cursor !== monitor.state.cursor) {
            monitor.state.cursor = updates.cursor
            await persist(monitor)
          }
        } catch (error) {
          if (signal.aborted) {
            return
          }
          if (isStale(error)) {
            monitor.status = 'expired'
            return
          }
          monitor.status = 'retrying'
          process.stderr.write(
            `[WeChat] Message loop retrying: ${error instanceof Error ? error.message : 'unknown error'}\n`
          )
          await delay(retryDelay, undefined, { signal })
          retryDelay = Math.min(15000, retryDelay * 2)
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        monitor.status = 'retrying'
        process.stderr.write(
          `[WeChat] Message loop stopped: ${error instanceof Error ? error.message : 'unknown error'}\n`
        )
      }
    }
  }

  const stop = async (connectionId: string) => {
    const monitor = monitors.get(connectionId)
    if (!monitor) {
      return
    }
    monitors.delete(connectionId)
    monitor.controller.abort()
    await monitor.done
    monitor.status = 'stopped'
    await notifyWeChat(monitor.connection, false).catch(() => undefined)
  }

  return {
    start: async (connection: StoredConnection) => {
      await stop(connection.id)
      const file = path.join(options.dataDir, `${connection.id}.messages.json`)
      let state = emptyState()
      try {
        state = readState(JSON.parse(await readFile(file, 'utf8')))
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          process.stderr.write(
            '[WeChat] Unable to restore message state; starting with a fresh cursor.\n'
          )
        }
      }
      const monitor: Monitor = {
        connection,
        controller: new AbortController(),
        file,
        state,
        status: 'starting',
        writes: Promise.resolve(),
        done: Promise.resolve(),
      }
      monitors.set(connection.id, monitor)
      monitor.done = run(monitor)
    },
    stop,
    clear: async (connectionId: string) => {
      await stop(connectionId)
      await rm(path.join(options.dataDir, `${connectionId}.messages.json`), { force: true })
    },
    stopAll: async () => {
      await Promise.all([...monitors.keys()].map((connectionId) => stop(connectionId)))
    },
    status: (connectionId: string): WeChatMessagingStatus =>
      monitors.get(connectionId)?.status ?? 'stopped',
  }
}
