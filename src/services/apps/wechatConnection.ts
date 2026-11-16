import { create } from 'zustand'
import { translate } from '../../i18n/index.js'

export type WeChatConnection = {
  id: string
  accountId: string
  userId?: string
  connectedAt: string
}

export type WeChatLoginStatus =
  | 'pending'
  | 'scanned'
  | 'pin_required'
  | 'connected'
  | 'already_connected'
  | 'cancelled'
  | 'expired'
  | 'failed'

export type WeChatMessagingStatus = 'starting' | 'online' | 'retrying' | 'expired' | 'stopped'

type ActiveLogin = {
  controller: AbortController
  id?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const available = () => ['http:', 'https:'].includes(window.location.protocol)

export const useWeChat = create<{
  available: boolean
  loading: boolean
  starting: boolean
  disconnecting: boolean
  connection: WeChatConnection | null
  aiConfigured: boolean
  aiModel: string
  messagingStatus: WeChatMessagingStatus
  attemptId: string | null
  qrContent: string
  loginStatus: WeChatLoginStatus | null
  pinError: boolean
  error: string
}>(() => ({
  available: available(),
  loading: available(),
  starting: false,
  disconnecting: false,
  connection: null,
  aiConfigured: false,
  aiModel: '',
  messagingStatus: 'stopped',
  attemptId: null,
  qrContent: '',
  loginStatus: null,
  pinError: false,
  error: '',
}))

export const wechatConnectionStatus = (state: ReturnType<typeof useWeChat.getState>) => {
  if (state.attemptId || state.starting) {
    return 'connectorConnecting' as const
  }
  if (state.connection) {
    return state.messagingStatus === 'expired'
      ? ('connectorUnavailable' as const)
      : ('connectorConnected' as const)
  }
  if (state.loading) {
    return 'connectorChecking' as const
  }
  return state.available ? ('connectorNotSignedIn' as const) : ('connectorUnavailable' as const)
}

const wechatRequest = async (
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal
) => {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(), method === 'POST' ? 20000 : 10000)
  try {
    return await fetch(path, {
      method,
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        'X-Chat-Demo-Request': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

const readConnection = (value: unknown): WeChatConnection | null => {
  if (value === null) {
    return null
  }
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{32}$/.test(value.id) ||
    typeof value.accountId !== 'string' ||
    !/^[a-zA-Z0-9@._-]{1,128}$/.test(value.accountId) ||
    typeof value.connectedAt !== 'string' ||
    (value.userId !== undefined && typeof value.userId !== 'string')
  ) {
    throw new Error(translate('wechatSessionFailed'))
  }
  return {
    id: value.id,
    accountId: value.accountId,
    userId: typeof value.userId === 'string' ? value.userId : undefined,
    connectedAt: value.connectedAt,
  }
}

const readAIStatus = (value: unknown) => {
  if (
    !isRecord(value) ||
    typeof value.configured !== 'boolean' ||
    typeof value.model !== 'string' ||
    !['starting', 'online', 'retrying', 'expired', 'stopped'].includes(String(value.messaging))
  ) {
    throw new Error(translate('wechatSessionFailed'))
  }
  return {
    aiConfigured: value.configured,
    aiModel: value.model,
    messagingStatus: value.messaging as WeChatMessagingStatus,
  }
}

let restoring: Promise<void> | null = null

export const restoreWeChatSession = (refresh = false): Promise<void> => {
  if (!available()) {
    useWeChat.setState({ available: false, loading: false, connection: null })
    return Promise.resolve()
  }
  if (restoring) {
    return refresh ? restoring.then(() => restoreWeChatSession(true)) : restoring
  }
  const run = async () => {
    useWeChat.setState({ loading: true, error: '' })
    try {
      const response = await wechatRequest('/api/wechat/session')
      const body: unknown = await response.json()
      if (!response.ok || !isRecord(body) || body.available !== true) {
        throw new Error(translate('wechatSessionFailed'))
      }
      useWeChat.setState({
        available: true,
        connection: readConnection(body.connection),
        ...readAIStatus(body.ai),
        error: '',
      })
    } catch {
      useWeChat.setState({ error: translate('wechatSessionFailed') })
    } finally {
      useWeChat.setState({ loading: false })
    }
  }
  restoring = run().finally(() => {
    restoring = null
  })
  return restoring
}

let activeLogin: ActiveLogin | null = null

const pause = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    const timer = setTimeout(finish, 900)
    signal.addEventListener('abort', abort, { once: true })
  })

const clearLogin = () =>
  useWeChat.setState({
    attemptId: null,
    qrContent: '',
    loginStatus: null,
    pinError: false,
    starting: false,
  })

const cancelOnServer = async (id: string) => {
  try {
    await wechatRequest('/api/wechat/cancel', 'POST', { attempt: id })
  } catch {
    // 服务端会让未取消的登录尝试自动过期。
  }
}

export const cancelWeChatLogin = () => {
  const login = activeLogin
  if (!login) {
    return
  }
  login.controller.abort()
  if (login.id) {
    void cancelOnServer(login.id)
  }
  clearLogin()
}

const pollLogin = async (id: string, signal: AbortSignal) => {
  while (!signal.aborted) {
    let response: Response
    try {
      response = await wechatRequest(
        `/api/wechat/status?attempt=${encodeURIComponent(id)}`,
        'GET',
        undefined,
        signal
      )
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof TypeError) {
        await pause(signal)
        continue
      }
      throw error
    }
    if (response.status === 404) {
      throw new Error(translate('wechatLoginExpired'))
    }
    const body: unknown = await response.json()
    if (!response.ok || !isRecord(body) || typeof body.status !== 'string') {
      throw new Error(translate('wechatLoginFailed'))
    }
    const status = body.status as WeChatLoginStatus
    useWeChat.setState({
      loginStatus: status,
      qrContent: typeof body.qrContent === 'string' ? body.qrContent : '',
      pinError: body.pinError === true,
    })
    if (status === 'connected') {
      const connection = readConnection(body.connection)
      if (!connection) {
        throw new Error(translate('wechatSessionFailed'))
      }
      useWeChat.setState({ connection, error: '' })
      await restoreWeChatSession(true)
      clearLogin()
      return
    }
    if (status === 'already_connected') {
      throw new Error(translate('wechatAlreadyConnected'))
    }
    if (status === 'expired') {
      throw new Error(translate('wechatLoginExpired'))
    }
    if (status === 'failed') {
      throw new Error(
        translate(body.error === 'storage' ? 'wechatStorageFailed' : 'wechatLoginFailed')
      )
    }
    if (status === 'cancelled') {
      clearLogin()
      return
    }
    await pause(signal)
  }
}

export const startWeChatLogin = async () => {
  if (activeLogin || !available()) {
    if (!available()) {
      useWeChat.setState({ error: translate('wechatUnavailable') })
    }
    return
  }
  const login: ActiveLogin = { controller: new AbortController() }
  activeLogin = login
  const { signal } = login.controller
  useWeChat.setState({
    starting: true,
    attemptId: null,
    qrContent: '',
    loginStatus: 'pending',
    pinError: false,
    error: '',
  })
  try {
    const response = await wechatRequest('/api/wechat/login', 'POST', {}, signal)
    const body: unknown = await response.json()
    if (
      !response.ok ||
      !isRecord(body) ||
      typeof body.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{32}$/.test(body.id) ||
      typeof body.qrContent !== 'string' ||
      !body.qrContent
    ) {
      throw new Error(translate('wechatLoginFailed'))
    }
    login.id = body.id
    if (signal.aborted) {
      await cancelOnServer(body.id)
      signal.throwIfAborted()
    }
    useWeChat.setState({
      starting: false,
      attemptId: body.id,
      qrContent: body.qrContent,
      loginStatus: 'pending',
    })
    await pollLogin(body.id, signal)
  } catch (error) {
    if (!signal.aborted) {
      useWeChat.setState({
        error: error instanceof Error ? error.message : translate('wechatLoginFailed'),
      })
    }
    clearLogin()
  } finally {
    activeLogin = null
    useWeChat.setState({ starting: false })
  }
}

export const submitWeChatPin = async (code: string) => {
  const attemptId = useWeChat.getState().attemptId
  if (!attemptId || !/^\d{1,16}$/.test(code)) {
    throw new Error(translate('wechatInvalidPin'))
  }
  const response = await wechatRequest('/api/wechat/pin', 'POST', { attempt: attemptId, code })
  if (!response.ok) {
    throw new Error(translate('wechatInvalidPin'))
  }
  useWeChat.setState({ pinError: false })
}

export const disconnectWeChat = async () => {
  if (useWeChat.getState().disconnecting) {
    return
  }
  cancelWeChatLogin()
  useWeChat.setState({ disconnecting: true, error: '' })
  try {
    const response = await wechatRequest('/api/wechat/logout', 'POST')
    if (!response.ok) {
      throw new Error(translate('wechatDisconnectFailed'))
    }
    useWeChat.setState({ connection: null, messagingStatus: 'stopped' })
  } catch (error) {
    useWeChat.setState({
      error: error instanceof Error ? error.message : translate('wechatDisconnectFailed'),
    })
  } finally {
    useWeChat.setState({ disconnecting: false })
  }
}
