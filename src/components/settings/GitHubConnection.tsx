import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  connectGitHub,
  disconnectGitHub,
  startGitHubLogin,
  useGitHub,
} from '../../services/apps/github.js'
import { Button } from '../base/Button.js'
import styles from './GitHubConnection.module.css'

export const GitHubConnection = () => {
  const t = useTranslate()
  const connection = useGitHub((state) => state.connection)
  const configured = useGitHub((state) => state.oauthConfigured)
  const loading = useGitHub((state) => state.oauthLoading)
  const oauthError = useGitHub((state) => state.oauthError)
  const disconnecting = useGitHub((state) => state.disconnecting)
  const [privateRepositories, setPrivateRepositories] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const id = useId()

  useEffect(() => () => requestRef.current?.abort(), [])

  const connect = async () => {
    if (requestRef.current) {
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    setBusy(true)
    setError('')
    try {
      await connectGitHub(token, controller.signal)
      setToken('')
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t('githubNetworkError'))
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false)
      }
      requestRef.current = null
    }
  }

  return (
    <section className={styles.connection} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>GitHub</h2>
      <p>{t('githubDescription')}</p>
      {connection ? (
        <>
          <div className={styles.connected}>
            <span role="status">{t('githubConnected', { login: connection.login })}</span>
            <Button
              variant="outlined"
              size="m"
              disabled={disconnecting}
              onClick={() => void disconnectGitHub()}
            >
              {disconnecting ? t('githubDisconnecting') : t('githubDisconnect')}
            </Button>
          </div>
          <p>{t('githubTryPrompt')}</p>
          <p>{connection.auth === 'oauth' ? t('githubOAuthStorage') : t('githubTokenStorage')}</p>
        </>
      ) : (
        <>
          <div className={styles.oauth}>
            <p>{t('githubOAuthDescription')}</p>
            <label className={styles.oauthOptions}>
              <input
                type="checkbox"
                checked={privateRepositories}
                disabled={busy || loading}
                onChange={(event) => setPrivateRepositories(event.target.checked)}
              />
              {t('githubOAuthPrivate')}
            </label>
            <Button
              size="m"
              disabled={!configured || loading || busy}
              onClick={() => startGitHubLogin(privateRepositories)}
            >
              {loading ? t('githubOAuthChecking') : t('githubOAuthLogin')}
            </Button>
            {!loading && !configured ? <p>{t('githubOAuthUnconfigured')}</p> : null}
          </div>
          <details className={styles.tokenFallback}>
            <summary>{t('githubTokenFallback')}</summary>
            <form
              aria-label={t('githubConnect')}
              onSubmit={(event) => {
                event.preventDefault()
                void connect()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                  event.preventDefault()
                }
              }}
            >
              <label htmlFor={`${id}-token`}>{t('githubToken')}</label>
              <p id={`${id}-help`}>{t('githubTokenHelp')}</p>
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
              >
                {t('githubGetToken')}
              </a>
              <input
                id={`${id}-token`}
                name="github-token"
                type="password"
                required
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={token}
                disabled={busy || loading}
                aria-describedby={`${id}-help ${id}-storage${error ? ` ${id}-error` : ''}`}
                aria-invalid={!!error}
                onChange={(event) => {
                  setToken(event.target.value)
                  setError('')
                }}
              />
              <div role="status" aria-live="polite" className={styles.error} id={`${id}-error`}>
                {error}
              </div>
              <Button type="submit" size="m" disabled={busy || loading}>
                {busy ? t('githubConnecting') : t('githubConnect')}
              </Button>
            </form>
            <p id={`${id}-storage`}>{t('githubTokenStorage')}</p>
          </details>
        </>
      )}
      <div role="status" aria-live="polite" className={styles.error}>
        {oauthError}
      </div>
    </section>
  )
}
