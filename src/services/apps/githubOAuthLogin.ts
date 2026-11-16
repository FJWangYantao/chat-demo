import { translate, type TranslationKey } from '../../i18n/index.js'
import { useSettings } from '../settings.js'
import { githubSessionRequest, restoreGitHubSession, useGitHub } from './githubConnection.js'

type Login = {
  controller: AbortController
  tab: Window
  id?: string
  notified: boolean
  callbackReceived: boolean
  wake?: () => void
}
let currentLogin: Login | null = null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pause = (login: Login) =>
  new Promise<void>((resolve, reject) => {
    const { signal } = login.controller
    signal.throwIfAborted()
    if (login.notified) {
      login.notified = false
      resolve()
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      window.removeEventListener('focus', finish)
      login.wake = undefined
    }
    const finish = () => {
      cleanup()
      login.notified = false
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    const timer = setTimeout(finish, login.callbackReceived ? 250 : 1200)
    login.wake = finish
    signal.addEventListener('abort', abort, { once: true })
    window.addEventListener('focus', finish, { once: true })
  })

const closeTab = (tab: Window) => {
  try {
    tab.close()
  } catch {
    // 跨源隔离可能切断窗口句柄，授权结果仍通过服务器同步。
  }
}

const cancelAttempt = async (login: Login) => {
  if (!login.id) {
    return
  }
  try {
    await githubSessionRequest(`/auth/github/cancel?attempt=${login.id}`, 'POST')
  } catch {
    // 等待记录会在服务器过期，不影响已有连接。
  }
}

export const cancelGitHubLogin = () => {
  if (!currentLogin) {
    return
  }
  currentLogin.controller.abort()
  closeTab(currentLogin.tab)
}

export const startGitHubLogin = async (
  privateRepositories: boolean,
  account?: string
): Promise<boolean> => {
  if (currentLogin) {
    return false
  }
  let tab: Window | null
  try {
    tab = window.open('about:blank', '_blank')
    if (tab) {
      tab.opener = null
    }
  } catch {
    tab = null
  }
  if (!tab) {
    useGitHub.setState({ oauthError: translate('githubOAuthPopupBlocked') })
    return false
  }
  const login: Login = {
    controller: new AbortController(),
    tab,
    notified: false,
    callbackReceived: false,
  }
  const signal = login.controller.signal
  currentLogin = login
  useGitHub.setState({ oauthPending: true, oauthError: '' })
  let connected = false
  let channel: BroadcastChannel | undefined
  try {
    const response = await githubSessionRequest('/auth/github/attempt', 'POST', undefined, {
      signal,
      body: { privateRepositories, login: account, locale: useSettings.getState().locale },
    })
    const attempt: unknown = await response.json()
    if (
      !response.ok ||
      !isRecord(attempt) ||
      typeof attempt.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{32}$/.test(attempt.id) ||
      typeof attempt.loginUrl !== 'string'
    ) {
      throw new Error(translate('githubOAuthFailed'))
    }
    login.id = attempt.id
    signal.throwIfAborted()
    const url = new URL(attempt.loginUrl, window.location.origin)
    if (url.origin !== window.location.origin || url.pathname !== '/auth/github/login') {
      throw new Error(translate('githubOAuthFailed'))
    }
    if (tab.closed) {
      login.controller.abort()
      signal.throwIfAborted()
    }
    try {
      channel = new BroadcastChannel(`chat-demo:github-oauth:${attempt.id}`)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (
          event.origin === window.location.origin &&
          event.data === 'callback' &&
          !signal.aborted
        ) {
          login.callbackReceived = true
          login.notified = true
          login.wake?.()
        }
      }
    } catch {
      channel = undefined
    }
    tab.location.href = url.href
    const deadline = Date.now() + 600000
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      try {
        const statusResponse = await githubSessionRequest(
          `/auth/github/attempt?attempt=${login.id}`,
          'GET',
          undefined,
          { signal }
        )
        if (statusResponse.status === 404) {
          throw new Error(translate('githubOAuthTimedOut'))
        }
        if (!statusResponse.ok) {
          await pause(login)
          continue
        }
        const result: unknown = await statusResponse.json()
        if (!isRecord(result) || typeof result.status !== 'string') {
          throw new Error(translate('githubOAuthFailed'))
        }
        if (result.status === 'connected') {
          if (typeof result.connectionId !== 'string') {
            throw new Error(translate('githubOAuthFailed'))
          }
          await restoreGitHubSession('connected', result.connectionId)
          signal.throwIfAborted()
          if (
            !useGitHub
              .getState()
              .connections.some((item) => item.auth === 'oauth' && item.id === result.connectionId)
          ) {
            throw new Error(translate('githubSessionFailed'))
          }
          connected = true
          return true
        }
        if (result.status !== 'pending') {
          if (result.status === 'failed') {
            useGitHub.setState({ oauthError: translate('githubOAuthFailed') })
            await restoreGitHubSession(result.status)
            return false
          }
          const keys: Record<string, TranslationKey> = {
            denied: 'githubOAuthDenied',
            invalid_state: 'githubOAuthInvalidState',
            unconfigured: 'githubOAuthUnconfigured',
            cancelled: 'githubOAuthCancelled',
            expired: 'githubOAuthTimedOut',
            network_error: 'githubOAuthNetworkError',
            invalid_credentials: 'githubOAuthCredentialsError',
            code_expired: 'githubOAuthCodeExpired',
          }
          throw new Error(translate(keys[result.status] ?? 'githubOAuthFailed'))
        }
      } catch (error) {
        signal.throwIfAborted()
        if (
          !(error instanceof TypeError) &&
          !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          throw error
        }
      }
      await pause(login)
    }
    throw new Error(translate('githubOAuthTimedOut'))
  } catch (reason) {
    useGitHub.setState({
      oauthError: signal.aborted
        ? translate('githubOAuthCancelled')
        : reason instanceof Error
          ? reason.message
          : translate('githubOAuthFailed'),
    })
    return false
  } finally {
    channel?.close()
    if (!connected) {
      await cancelAttempt(login)
    }
    closeTab(tab)
    currentLogin = null
    useGitHub.setState({ oauthPending: false })
  }
}
