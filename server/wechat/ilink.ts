import { randomBytes } from 'node:crypto'

export const DEFAULT_WECHAT_API_ORIGIN = 'https://ilinkai.weixin.qq.com'
const CHANNEL_VERSION = '2.4.10'
const CLIENT_VERSION = (2 << 16) | (4 << 8) | 10
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isLocalHostname = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)

export const normalizeWeChatOrigin = (value: string) => {
  const url = new URL(value)
  const local = isLocalHostname(url.hostname)
  const trustedHost = url.hostname === 'qq.com' || url.hostname.endsWith('.qq.com')
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    (!local && !trustedHost)
  ) {
    throw new Error('invalid_wechat_origin')
  }
  return url.origin
}

const appHeaders = () => ({
  'iLink-App-Id': 'bot',
  'iLink-App-ClientVersion': String(CLIENT_VERSION),
})

const randomWechatUin = () => {
  const value = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(value), 'utf8').toString('base64')
}

const requestJson = async (
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<unknown> => {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error('wechat_response_too_large')
  }
  if (!response.ok) {
    throw new Error(`wechat_http_${response.status}`)
  }
  try {
    return parseWeChatJson(text) as unknown
  } catch {
    throw new Error('wechat_invalid_json')
  }
}

const LOSSLESS_ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id'])

const parseWeChatJson = (rawText: string): unknown => {
  let output = ''
  let index = 0
  while (index < rawText.length) {
    if (rawText[index] !== '"') {
      output += rawText[index++]
      continue
    }
    const stringStart = index
    index++
    let escaped = false
    while (index < rawText.length) {
      const char = rawText[index++]
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        break
      }
    }
    const stringToken = rawText.slice(stringStart, index)
    output += stringToken
    let cursor = index
    while (/\s/.test(rawText[cursor] ?? '')) {
      cursor++
    }
    if (rawText[cursor] !== ':') {
      continue
    }
    let key: unknown
    try {
      key = JSON.parse(stringToken)
    } catch {
      continue
    }
    if (typeof key !== 'string' || !LOSSLESS_ID_FIELDS.has(key)) {
      continue
    }
    output += rawText.slice(index, cursor + 1)
    cursor++
    while (/\s/.test(rawText[cursor] ?? '')) {
      output += rawText[cursor++]
    }
    const numberStart = cursor
    if (rawText[cursor] === '-') {
      cursor++
    }
    while (/\d/.test(rawText[cursor] ?? '')) {
      cursor++
    }
    if (cursor > numberStart && !(cursor === numberStart + 1 && rawText[numberStart] === '-')) {
      output += `"${rawText.slice(numberStart, cursor)}"`
      index = cursor
    } else {
      index = numberStart
    }
  }
  return JSON.parse(output) as unknown
}

export type WeChatQrCode = {
  id: string
  content: string
}

export const fetchWeChatQrCode = async (
  apiOrigin: string,
  localTokens: string[],
  signal?: AbortSignal
): Promise<WeChatQrCode> => {
  const url = new URL('/ilink/bot/get_bot_qrcode', `${apiOrigin}/`)
  url.searchParams.set('bot_type', '3')
  const body = await requestJson(
    url,
    {
      method: 'POST',
      headers: {
        ...appHeaders(),
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': randomWechatUin(),
      },
      body: JSON.stringify({ local_token_list: localTokens.slice(0, 10) }),
    },
    15000,
    signal
  )
  if (
    !isRecord(body) ||
    typeof body.qrcode !== 'string' ||
    !body.qrcode ||
    body.qrcode.length > 8192 ||
    typeof body.qrcode_img_content !== 'string' ||
    !body.qrcode_img_content ||
    body.qrcode_img_content.length > 8192
  ) {
    throw new Error('wechat_invalid_qr_response')
  }
  return { id: body.qrcode, content: body.qrcode_img_content }
}

export type WeChatQrStatus = {
  status: string
  botToken?: string
  accountId?: string
  baseUrl?: string
  userId?: string
  redirectHost?: string
}

export const pollWeChatQrCode = async (
  apiOrigin: string,
  qrcode: string,
  verifyCode?: string,
  signal?: AbortSignal
): Promise<WeChatQrStatus> => {
  const url = new URL('/ilink/bot/get_qrcode_status', `${apiOrigin}/`)
  url.searchParams.set('qrcode', qrcode)
  if (verifyCode) {
    url.searchParams.set('verify_code', verifyCode)
  }
  const body = await requestJson(url, { method: 'GET', headers: appHeaders() }, 35000, signal)
  if (!isRecord(body) || typeof body.status !== 'string' || !body.status) {
    throw new Error('wechat_invalid_status_response')
  }
  return {
    status: body.status,
    botToken: typeof body.bot_token === 'string' ? body.bot_token : undefined,
    accountId: typeof body.ilink_bot_id === 'string' ? body.ilink_bot_id : undefined,
    baseUrl: typeof body.baseurl === 'string' ? body.baseurl : undefined,
    userId: typeof body.ilink_user_id === 'string' ? body.ilink_user_id : undefined,
    redirectHost: typeof body.redirect_host === 'string' ? body.redirect_host : undefined,
  }
}

export type WeChatApiAccess = {
  baseUrl: string
  token: string
}

export type WeChatInboundMessage = {
  message_id?: string
  from_user_id?: string
  to_user_id?: string
  group_id?: string
  message_type?: number
  context_token?: string
  item_list?: {
    type?: number
    text_item?: { text?: string }
    voice_item?: { text?: string }
    image_item?: unknown
    file_item?: unknown
    video_item?: unknown
  }[]
}

export class WeChatApiError extends Error {
  code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'WeChatApiError'
    this.code = code
  }
}

const postWeChat = async (
  access: WeChatApiAccess,
  endpoint: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<unknown> => {
  const url = new URL(endpoint, `${normalizeWeChatOrigin(access.baseUrl)}/`)
  return requestJson(
    url,
    {
      method: 'POST',
      headers: {
        ...appHeaders(),
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': randomWechatUin(),
        Authorization: `Bearer ${access.token}`,
      },
      body: JSON.stringify({
        ...(isRecord(body) ? body : {}),
        base_info: { channel_version: CHANNEL_VERSION, bot_agent: 'chat-demo/0.1.1' },
      }),
    },
    timeoutMs,
    signal
  )
}

const responseCode = (body: Record<string, unknown>) => {
  const ret = typeof body.ret === 'number' ? body.ret : 0
  const errcode = typeof body.errcode === 'number' ? body.errcode : 0
  return ret || errcode
}

const assertWeChatSuccess = (body: Record<string, unknown>, label: string) => {
  const code = responseCode(body)
  if (code !== 0) {
    throw new WeChatApiError(`${label}_failed`, code)
  }
}

export type WeChatUpdates = {
  code: number
  messages: WeChatInboundMessage[]
  cursor: string
  nextTimeoutMs: number
}

export const getWeChatUpdates = async (
  access: WeChatApiAccess,
  cursor: string,
  timeoutMs = 35000,
  signal?: AbortSignal
): Promise<WeChatUpdates> => {
  try {
    const body = await postWeChat(
      access,
      '/ilink/bot/getupdates',
      { get_updates_buf: cursor },
      timeoutMs,
      signal
    )
    if (!isRecord(body)) {
      throw new Error('wechat_invalid_updates_response')
    }
    return {
      code: responseCode(body),
      messages: Array.isArray(body.msgs) ? (body.msgs as WeChatInboundMessage[]) : [],
      cursor: typeof body.get_updates_buf === 'string' ? body.get_updates_buf : cursor,
      nextTimeoutMs:
        typeof body.longpolling_timeout_ms === 'number' &&
        Number.isFinite(body.longpolling_timeout_ms) &&
        body.longpolling_timeout_ms >= 1000 &&
        body.longpolling_timeout_ms <= 60000
          ? body.longpolling_timeout_ms
          : 35000,
    }
  } catch (error) {
    if (
      !signal?.aborted &&
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)
    ) {
      return { code: 0, messages: [], cursor, nextTimeoutMs: timeoutMs }
    }
    throw error
  }
}

export const sendWeChatText = async (
  access: WeChatApiAccess,
  options: {
    to: string
    text: string
    contextToken?: string
    clientId: string
  },
  signal?: AbortSignal
) => {
  const body = await postWeChat(
    access,
    '/ilink/bot/sendmessage',
    {
      msg: {
        from_user_id: '',
        to_user_id: options.to,
        client_id: options.clientId,
        message_type: 2,
        message_state: 2,
        context_token: options.contextToken || undefined,
        item_list: [{ type: 1, text_item: { text: options.text } }],
      },
    },
    15000,
    signal
  )
  if (!isRecord(body)) {
    throw new Error('wechat_invalid_send_response')
  }
  assertWeChatSuccess(body, 'send_message')
}

export const getWeChatTypingTicket = async (
  access: WeChatApiAccess,
  userId: string,
  contextToken?: string,
  signal?: AbortSignal
) => {
  const body = await postWeChat(
    access,
    '/ilink/bot/getconfig',
    { ilink_user_id: userId, context_token: contextToken || undefined },
    10000,
    signal
  )
  if (!isRecord(body)) {
    throw new Error('wechat_invalid_config_response')
  }
  assertWeChatSuccess(body, 'get_config')
  return typeof body.typing_ticket === 'string' ? body.typing_ticket : ''
}

export const sendWeChatTyping = async (
  access: WeChatApiAccess,
  options: { userId: string; ticket: string; typing: boolean },
  signal?: AbortSignal
) => {
  const body = await postWeChat(
    access,
    '/ilink/bot/sendtyping',
    {
      ilink_user_id: options.userId,
      typing_ticket: options.ticket,
      status: options.typing ? 1 : 2,
    },
    10000,
    signal
  )
  if (isRecord(body)) {
    assertWeChatSuccess(body, 'send_typing')
  }
}

export const notifyWeChat = async (
  access: WeChatApiAccess,
  start: boolean,
  signal?: AbortSignal
) => {
  const body = await postWeChat(
    access,
    start ? '/ilink/bot/msg/notifystart' : '/ilink/bot/msg/notifystop',
    {},
    10000,
    signal
  )
  if (isRecord(body)) {
    assertWeChatSuccess(body, start ? 'notify_start' : 'notify_stop')
  }
}
