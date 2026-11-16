import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  connectGitHub,
  disconnectGitHub,
  githubConnectionStatus,
  renameGitHubConnection,
  restoreGitHubSession,
  selectGitHubConnection,
  setGitHubEnabled,
  useGitHub,
  type GitHubConnection as Connection,
} from '../../services/apps/githubConnection.js'
import { cancelGitHubLogin, startGitHubLogin } from '../../services/apps/githubOAuthLogin.js'
import { Button } from '../base/Button.js'
import { IconGitHub16 } from '../base/icons.js'
import styles from './GitHubConnection.module.css'

export const GitHubConnection = () => {
  const t = useTranslate()
  const connections = useGitHub((state) => state.connections)
  const activeId = useGitHub((state) => state.activeId)
  const enabled = useGitHub((state) => state.enabled)
  const loading = useGitHub((state) => state.oauthLoading)
  const pending = useGitHub((state) => state.oauthPending)
  const oauthError = useGitHub((state) => state.oauthError)
  const status = useGitHub(githubConnectionStatus)
  const [adding, setAdding] = useState(() => !connections.length)
  const addButton = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    void restoreGitHubSession()
  }, [])

  return (
    <section className={styles.connection} aria-labelledby={`${id}-heading`}>
      <header className={styles.header}>
        <h2 id={`${id}-heading`} className={styles.heading}>
          <IconGitHub16 />
          GitHub
        </h2>
        <span className={styles.status} data-status={status}>
          {t(status)}
        </span>
      </header>
      <p>{t('githubDescription')}</p>
      {pending ? (
        <div className={styles.waiting}>
          <progress className={styles.spinner} aria-labelledby={`${id}-waiting`} />
          <span id={`${id}-waiting`} role="status">
            {t('githubOAuthWaiting')}
          </span>
          <button type="button" className={styles.textButton} onClick={cancelGitHubLogin}>
            {t('cancel')}
          </button>
        </div>
      ) : null}
      <label className={styles.option} htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          name="github-enabled"
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(event) => setGitHubEnabled(event.target.checked)}
        />
        {t('githubEnabled')}
      </label>
      <div className={styles.sectionHeader}>
        <h3>{t('githubConnectionList')}</h3>
        <button
          ref={addButton}
          type="button"
          className={styles.textButton}
          aria-expanded={adding}
          aria-controls={`${id}-add`}
          disabled={pending}
          onClick={() => setAdding(!adding)}
        >
          {adding ? t('cancel') : t('githubAddConnection')}
        </button>
      </div>
      {connections.length ? (
        <>
          <div className={styles.accounts}>
            {connections.map((connection) => (
              <ConnectionItem key={connection.id} connection={connection} />
            ))}
          </div>
          <p>{t(activeId ? 'githubDefaultHint' : 'githubChooseConnection')}</p>
        </>
      ) : (
        <p>{t('githubNoConnections')}</p>
      )}
      <div id={`${id}-add`} hidden={!adding}>
        {adding ? (
          <AddConnection
            onConnected={() => {
              setAdding(false)
              addButton.current?.focus()
            }}
          />
        ) : null}
      </div>
      <div role="status" className={styles.error}>
        {oauthError}
        {oauthError ? (
          <button
            type="button"
            className={styles.textButton}
            disabled={loading}
            onClick={() => void restoreGitHubSession()}
          >
            {t('retry')}
          </button>
        ) : null}
      </div>
      <details className={styles.storage}>
        <summary>{t('githubPermissions')}</summary>
        <p>{t('githubOAuthStorage')}</p>
        <p>{t('githubTokenStorage')}</p>
      </details>
    </section>
  )
}

const ConnectionItem = ({ connection }: { connection: Connection }) => {
  const t = useTranslate()
  const active = useGitHub((state) => state.activeId === connection.id)
  const disconnecting = useGitHub((state) => state.disconnecting)
  const pending = useGitHub((state) => state.oauthPending)
  const [label, setLabel] = useState(connection.label)
  const [token, setToken] = useState('')
  const [privateRepositories, setPrivateRepositories] = useState(
    connection.auth === 'oauth' && connection.privateRepositories
  )
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const tokenInput = useRef<HTMLInputElement>(null)
  const id = useId()
  const permissionsChanged =
    connection.auth === 'oauth' && privateRepositories !== connection.privateRepositories

  useEffect(() => () => request.current?.abort(), [])

  const save = async () => {
    if (request.current || disconnecting) {
      return
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      if (connection.auth === 'token' && token) {
        await connectGitHub(token, controller.signal, { label, replaceId: connection.id })
        setToken('')
      } else {
        renameGitHubConnection(connection.id, label)
      }
      if (permissionsChanged) {
        setSaved(await startGitHubLogin(privateRepositories, connection.login))
      } else {
        setSaved(true)
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t('githubNetworkError'))
        tokenInput.current?.focus()
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false)
      }
      request.current = null
    }
  }

  return (
    <article className={styles.account} aria-labelledby={`${id}-name`}>
      <div className={styles.accountHeader}>
        <div className={styles.accountText}>
          <h4 id={`${id}-name`}>
            {connection.label}
            {active ? <span className={styles.status}>{t('githubDefaultConnection')}</span> : null}
          </h4>
          <p>
            @{connection.login} ·{' '}
            {t(connection.auth === 'oauth' ? 'githubOAuthConnection' : 'githubTokenConnection')}
          </p>
        </div>
        <div className={styles.accountActions}>
          {!active ? (
            <button
              type="button"
              className={styles.textButton}
              disabled={!!disconnecting || busy || pending}
              aria-label={t('githubUseConnectionNamed', { name: connection.label })}
              onClick={() => selectGitHubConnection(connection.id)}
            >
              {t('githubUseConnection')}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.textButton}
            disabled={!!disconnecting || busy || pending}
            aria-label={t('githubDisconnectNamed', { name: connection.label })}
            onClick={() => void disconnectGitHub(connection.id)}
          >
            {t(disconnecting === connection.id ? 'githubDisconnecting' : 'githubDisconnect')}
          </button>
        </div>
      </div>
      <details className={styles.configuration}>
        <summary aria-label={t('githubConfigureConnectionNamed', { name: connection.label })}>
          {t('githubConfigureConnection')}
        </summary>
        <form
          aria-label={t('githubConfigureConnectionNamed', { name: connection.label })}
          onChange={() => setSaved(false)}
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) {
              event.preventDefault()
            }
          }}
        >
          <label htmlFor={`${id}-label`}>{t('githubConnectionName')}</label>
          <input
            id={`${id}-label`}
            name="connection-label"
            value={label}
            maxLength={60}
            required
            disabled={busy || !!disconnecting || pending}
            onChange={(event) => setLabel(event.target.value)}
          />
          {connection.auth === 'oauth' ? (
            <label className={styles.option} htmlFor={`${id}-private`}>
              <input
                id={`${id}-private`}
                name="private-repositories"
                type="checkbox"
                checked={privateRepositories}
                disabled={busy || !!disconnecting || pending}
                onChange={(event) => setPrivateRepositories(event.target.checked)}
              />
              {t('githubOAuthPrivate')}
            </label>
          ) : (
            <>
              <label htmlFor={`${id}-token`}>{t('githubReplaceToken')}</label>
              <input
                ref={tokenInput}
                id={`${id}-token`}
                name="replacement-token"
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={token}
                disabled={busy || !!disconnecting || pending}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setToken(event.target.value)
                  setError('')
                }}
              />
            </>
          )}
          <div className={styles.formActions}>
            <Button
              type="submit"
              variant="outlined"
              size="s"
              disabled={busy || !!disconnecting || pending}
            >
              {t(
                busy
                  ? 'githubConnecting'
                  : permissionsChanged
                    ? 'githubReauthorize'
                    : 'githubSaveConnection'
              )}
            </Button>
            {connection.auth === 'oauth' && !permissionsChanged ? (
              <button
                type="button"
                className={styles.textButton}
                disabled={busy || !!disconnecting || pending}
                onClick={() => startGitHubLogin(privateRepositories, connection.login)}
              >
                {t('githubReauthorize')}
              </button>
            ) : null}
            <span role="status">{saved ? t('githubConnectionSaved') : ''}</span>
          </div>
          <div role="status" className={styles.error} id={`${id}-error`}>
            {error}
          </div>
        </form>
      </details>
    </article>
  )
}

const AddConnection = ({ onConnected }: { onConnected: () => void }) => {
  const t = useTranslate()
  const configured = useGitHub((state) => state.oauthConfigured)
  const loading = useGitHub((state) => state.oauthLoading || state.oauthPending)
  const [privateRepositories, setPrivateRepositories] = useState(false)
  const [label, setLabel] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const tokenInput = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => () => request.current?.abort(), [])

  const connect = async () => {
    if (request.current) {
      return
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      await connectGitHub(token, controller.signal, { label })
      onConnected()
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t('githubNetworkError'))
        tokenInput.current?.focus()
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false)
      }
      request.current = null
    }
  }

  return (
    <div className={styles.addConnection}>
      <div className={styles.oauth}>
        <label className={styles.option} htmlFor={`${id}-private`}>
          <input
            id={`${id}-private`}
            name="private-repositories"
            type="checkbox"
            checked={privateRepositories}
            disabled={busy || loading}
            onChange={(event) => setPrivateRepositories(event.target.checked)}
          />
          {t('githubOAuthPrivate')}
        </label>
        <Button
          size="m"
          variant="outlined"
          disabled={!configured || loading || busy}
          onClick={() => {
            void startGitHubLogin(privateRepositories).then((connected) => {
              if (connected) {
                onConnected()
              }
            })
          }}
        >
          <IconGitHub16 />
          {t(loading ? 'githubOAuthChecking' : 'githubOAuthLogin')}
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
          <label htmlFor={`${id}-label`}>{t('githubConnectionName')}</label>
          <input
            id={`${id}-label`}
            name="connection-label"
            value={label}
            maxLength={60}
            disabled={busy || loading}
            onChange={(event) => setLabel(event.target.value)}
          />
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
            ref={tokenInput}
            id={`${id}-token`}
            name="github-token"
            type="password"
            required
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={token}
            disabled={busy || loading}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
            aria-invalid={!!error}
            onChange={(event) => {
              setToken(event.target.value)
              setError('')
            }}
          />
          <div role="status" className={styles.error} id={`${id}-error`}>
            {error}
          </div>
          <Button type="submit" size="m" variant="outlined" disabled={busy || loading}>
            {t(busy ? 'githubConnecting' : 'githubConnect')}
          </Button>
        </form>
      </details>
    </div>
  )
}
