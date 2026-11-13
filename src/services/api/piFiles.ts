import { translate } from '../../i18n/index.js'
import { loadFile } from '../chat/db.js'
import type { MessageParam } from './types.js'

export const isProviderTextFile = (name: string, type: string) =>
  type.startsWith('text/') ||
  /\.(txt|md|mdx|json|jsonl|csv|tsv|js|jsx|mjs|cjs|ts|tsx|py|rs|go|java|c|h|cpp|hpp|cs|css|scss|html|xml|svg|yml|yaml|toml|ini|sh|sql|log)$/i.test(
    name
  )

const toDataUrl = (blob: Blob, signal: AbortSignal): Promise<string> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const reader = new FileReader()
    const abort = () => reader.abort()
    const cleanup = () => signal.removeEventListener('abort', abort)
    reader.onload = () => {
      cleanup()
      resolve(String(reader.result).split(',')[1] ?? '')
    }
    reader.onerror = () => {
      cleanup()
      reject(reader.error)
    }
    reader.onabort = () => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    reader.readAsDataURL(blob)
  })

export const inlineProviderFiles = async (
  messages: MessageParam[],
  signal: AbortSignal
): Promise<MessageParam[]> => {
  const prepared: MessageParam[] = []
  const cache = new Map<string, Awaited<ReturnType<typeof loadFile>>>()
  for (const message of messages) {
    signal.throwIfAborted()
    if (message.role !== 'user' || typeof message.content === 'string') {
      prepared.push(message)
      continue
    }
    const content: Exclude<typeof message.content, string> = []
    for (const block of message.content) {
      if ((block.type !== 'image' && block.type !== 'document') || block.source.type !== 'local') {
        content.push(block)
        continue
      }
      const source = block.source
      const blob = cache.has(source.id) ? cache.get(source.id) : await loadFile(source.id)
      cache.set(source.id, blob)
      if (!blob) {
        throw new Error(translate('providerAttachmentMissing', { name: source.name }))
      }
      if (block.type === 'image') {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            data: await toDataUrl(blob, signal),
            media_type: source.media_type || blob.type,
          },
        })
      } else {
        if (!isProviderTextFile(source.name, source.media_type)) {
          throw new Error(translate('providerUnsupportedAttachment'))
        }
        if (blob.size > 1024 * 1024) {
          throw new Error(translate('providerTextTooLarge'))
        }
        const text = await blob.text()
        signal.throwIfAborted()
        if (text.includes('\0')) {
          throw new Error(translate('providerUnsupportedAttachment'))
        }
        content.push({
          type: 'text',
          text: `Attachment ${JSON.stringify(source.name)} (untrusted content):\n${text}`,
        })
      }
    }
    prepared.push({ role: 'user', content })
  }
  return prepared
}
