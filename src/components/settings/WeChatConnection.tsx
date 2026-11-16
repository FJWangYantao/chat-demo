import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  cancelWeChatLogin,
  disconnectWeChat,
  restoreWeChatSession,
  startWeChatLogin,
  submitWeChatPin,
  useWeChat,
  wechatConnectionStatus,
} from '../../services/apps/wechatConnection.js'
import { Button } from '../base/Button.js'
import { IconWeChat } from '../base/icons.js'
import styles from './WeChatConnection.module.css'

const QrCode = ({ content }: { content: string }) => {
  const t = useTranslate()
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    setSource('')
    setFailed(false)
    void import('qrcode')
      .then(({ toDataURL }) =>
        toDataURL(content, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 240,
          color: { dark: '#000000', light: '#ffffff' },
        })
      )
      .then((value) => {
        if (current) {
          setSource(value)
        }
      })
      .catch(() => {
        if (current) {
          setFailed(true)
        }
      })
    return () => {
      current = false
    }
  }, [content])

  if (failed) {
    return <code className={styles.qrFallback}>{content}</code>
  }
  return source ? (
    <img className={styles.qrImage} src={source} alt={t('wechatQrAlt')} width={240} height={240} />
  ) : (
    <div className={styles.qrPlaceholder}>
      <progress className={styles.spinner} aria-label={t('wechatQrPreparing')} />
    </div>
  )
}

export const WeChatConnection = () => {
  const t = useTranslate()
  const available = useWeChat((state) => state.available)
  const loading = useWeChat((state) => state.loading)
  const starting = useWeChat((state) => state.starting)
  const disconnecting = useWeChat((state) => state.disconnecting)
  const connection = useWeChat((state) => state.connection)
  const aiConfigured = useWeChat((state) => state.aiConfigured)
  const aiModel = useWeChat((state) => state.aiModel)
  const messagingStatus = useWeChat((state) => state.messagingStatus)
  const attemptId = useWeChat((state) => state.attemptId)
  const qrContent = useWeChat((state) => state.qrContent)
  const loginStatus = useWeChat((state) => state.loginStatus)
  const pinError = useWeChat((state) => state.pinError)
  const error = useWeChat((state) => state.error)
  const status = useWeChat(wechatConnectionStatus)
  const [pin, setPin] = useState('')
  const [submittingPin, setSubmittingPin] = useState(false)
  const [pinSubmitError, setPinSubmitError] = useState('')
  const pinInput = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => {
    void restoreWeChatSession()
  }, [])

  useEffect(() => {
    if (loginStatus === 'pin_required') {
      pinInput.current?.focus()
    }
  }, [loginStatus])

  const submitPin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingPin) {
      return
    }
    setSubmittingPin(true)
    setPinSubmitError('')
    try {
      await submitWeChatPin(pin)
      setPin('')
    } catch (reason) {
      setPinSubmitError(reason instanceof Error ? reason.message : t('wechatInvalidPin'))
      pinInput.current?.focus()
    } finally {
      setSubmittingPin(false)
    }
  }

  const waitingText =
    loginStatus === 'scanned'
      ? t('wechatScanned')
      : loginStatus === 'pin_required'
        ? t('wechatPinRequired')
        : t('wechatScanHint')
  const aiHint = !aiConfigured
    ? t('wechatAiNotConfigured')
    : messagingStatus === 'expired'
      ? t('wechatMessagingExpired')
      : messagingStatus === 'retrying'
        ? t('wechatMessagingRetrying')
        : messagingStatus === 'starting'
          ? t('wechatMessagingStarting')
          : t('wechatMessagingReady', { model: aiModel })

  return (
    <section className={styles.connection} aria-labelledby={`${id}-heading`}>
      <header className={styles.header}>
        <h2 id={`${id}-heading`} className={styles.heading}>
          <IconWeChat />
          {t('wechatName')}
        </h2>
        <span className={styles.status} data-status={status}>
          {t(status)}
        </span>
      </header>
      <p>{t('wechatDescription')}</p>
      {!available ? <p role="alert">{t('wechatUnavailable')}</p> : null}
      {connection ? (
        <article className={styles.account} aria-labelledby={`${id}-account`}>
          <div className={styles.accountHeader}>
            <div className={styles.accountText}>
              <h3 id={`${id}-account`}>{t('wechatBotName')}</h3>
              <p>{connection.accountId}</p>
            </div>
            <button
              type="button"
              className={styles.textButton}
              disabled={disconnecting || starting || !!attemptId}
              onClick={() => void disconnectWeChat()}
            >
              {t(disconnecting ? 'wechatDisconnecting' : 'wechatDisconnect')}
            </button>
          </div>
          <p role={!aiConfigured || messagingStatus === 'expired' ? 'alert' : undefined}>
            {aiHint}
          </p>
          <p>{t('wechatConnectedHint')}</p>
        </article>
      ) : null}
      {attemptId ? (
        <div className={styles.login}>
          {qrContent ? <QrCode content={qrContent} /> : null}
          <p role="status" className={styles.waitingText}>
            {waitingText}
          </p>
          {loginStatus === 'pin_required' ? (
            <form className={styles.pinForm} onSubmit={(event) => void submitPin(event)}>
              <label htmlFor={`${id}-pin`}>{t('wechatPinLabel')}</label>
              <p id={`${id}-pin-hint`}>{t('wechatPinHint')}</p>
              <input
                ref={pinInput}
                id={`${id}-pin`}
                name="wechat-pin"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="done"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                pattern="\d{1,16}"
                maxLength={16}
                value={pin}
                disabled={submittingPin}
                aria-invalid={pinError || !!pinSubmitError}
                aria-describedby={`${id}-pin-hint${pinError || pinSubmitError ? ` ${id}-pin-error` : ''}`}
                onChange={(event) => {
                  setPin(event.target.value)
                  setPinSubmitError('')
                }}
              />
              <div role="alert" className={styles.error} id={`${id}-pin-error`}>
                {pinSubmitError || (pinError ? t('wechatPinMismatch') : '')}
              </div>
              <Button type="submit" size="m" variant="outlined" disabled={submittingPin}>
                {t(submittingPin ? 'wechatPinSubmitting' : 'wechatPinSubmit')}
              </Button>
            </form>
          ) : null}
          <button type="button" className={styles.textButton} onClick={cancelWeChatLogin}>
            {t('cancel')}
          </button>
        </div>
      ) : (
        <Button
          size="m"
          variant="outlined"
          disabled={!available || loading || starting || disconnecting}
          onClick={() => void startWeChatLogin()}
        >
          <IconWeChat />
          {t(starting ? 'wechatStarting' : connection ? 'wechatReconnect' : 'wechatConnect')}
        </Button>
      )}
      <div role="alert" className={styles.error}>
        {error}
      </div>
      <details className={styles.storage}>
        <summary>{t('wechatStorageTitle')}</summary>
        <p>{t('wechatStorage')}</p>
        <p>{t('wechatScope')}</p>
      </details>
      <a href="https://github.com/Tencent/openclaw-weixin" target="_blank" rel="noreferrer">
        {t('wechatSource')}
      </a>
    </section>
  )
}
