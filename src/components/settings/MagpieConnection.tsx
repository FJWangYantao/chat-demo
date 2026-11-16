import { useEffect, useId, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  loadMagpieModels,
  magpieConnectionStatus,
  saveMagpieModel,
  useMagpie,
} from '../../services/apps/magpieConnection.js'
import { MAGPIE_PROVIDER, useProviders } from '../../services/providers.js'
import { Button } from '../base/Button.js'
import { IconMagpie, IconRefreshOutline16 } from '../base/icons.js'
import { MagpieModelPicker } from './MagpieModelPicker.js'
import styles from './MagpieConnection.module.css'

export const MagpieConnection = () => {
  const t = useTranslate()
  const models = useMagpie((state) => state.models)
  const checked = useMagpie((state) => state.checked)
  const connected = useMagpie((state) => state.connected)
  const loading = useMagpie((state) => state.loading)
  const error = useMagpie((state) => state.error)
  const active = useProviders((state) => state.active === MAGPIE_PROVIDER)
  const status = useMagpie((state) => magpieConnectionStatus(state, active))
  const profile = useProviders((state) => state.profiles[MAGPIE_PROVIDER])
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const id = useId()
  const model = draft ?? profile?.model ?? models[0]?.id ?? ''
  const definition = models.find((item) => item.id === model)
  const modelMissing =
    connected && !loading && !!profile?.model && model === profile.model && !definition
  const warningId = modelMissing ? `${id}-model-missing` : undefined
  const showForm = checked && (models.length > 0 || !!model)

  useEffect(() => {
    const detect = () => {
      if (document.visibilityState === 'visible') {
        void loadMagpieModels()
      }
    }
    detect()
    window.addEventListener('focus', detect)
    return () => window.removeEventListener('focus', detect)
  }, [])

  return (
    <section className={styles.connection} aria-labelledby={`${id}-heading`}>
      <header className={styles.header}>
        <h2 id={`${id}-heading`} className={styles.heading}>
          <IconMagpie />
          Magpie
        </h2>
        <span className={styles.status} data-status={status}>
          {t(status)}
        </span>
      </header>
      <p>{t('magpieDescription')}</p>
      <p>{t('magpieLocalHint')}</p>
      <Button
        size="m"
        variant="outlined"
        disabled={loading}
        onClick={() => void loadMagpieModels()}
      >
        <IconRefreshOutline16 />
        {t(
          loading
            ? connected
              ? 'magpieRefreshing'
              : 'magpieChecking'
            : connected
              ? 'magpieRefresh'
              : checked
                ? 'magpieRetry'
                : 'magpieConnect'
        )}
      </Button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!connected && checked && models.length ? (
        <p className={styles.warning}>{t('magpieStaleCatalog')}</p>
      ) : null}
      {showForm ? (
        <form
          className={styles.form}
          aria-label={t('magpieUseModel')}
          aria-busy={loading}
          onSubmit={(event) => {
            event.preventDefault()
            if (!connected || loading) {
              return
            }
            setFormError('')
            try {
              saveMagpieModel(model)
              setSaved(true)
            } catch (reason) {
              setFormError(reason instanceof Error ? reason.message : t('unknownError'))
            }
          }}
        >
          <MagpieModelPicker
            id={id}
            models={models}
            value={model}
            invalid={!!formError}
            warningId={warningId}
            onChange={(value) => {
              setDraft(value)
              setSaved(false)
              setFormError('')
            }}
          />
          {modelMissing ? (
            <p id={warningId} className={styles.warning} role="status">
              {t('magpieModelMissing')}
            </p>
          ) : null}
          <p>
            {definition
              ? t('providerCapabilities', {
                  reasoning: t(definition.reasoning ? 'providerSupported' : 'providerUnsupported'),
                  images: t(definition.imageInput ? 'providerSupported' : 'providerUnsupported'),
                })
              : t('magpieManualCapabilities')}
          </p>
          {formError ? (
            <p id={`${id}-form-error`} className={styles.error} role="alert">
              {formError}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              type="submit"
              size="m"
              disabled={saved || !connected || loading}
              className={saved ? styles.savedButton : undefined}
            >
              {t('providerSave')}
            </Button>
          </div>
        </form>
      ) : connected && !loading ? (
        <p role="status">{t('magpieNoModels')}</p>
      ) : null}
      <details className={styles.storage}>
        <summary>{t('magpieStorageTitle')}</summary>
        <p>{t('magpieStorage')}</p>
      </details>
      <a href="https://usemagpie.ai/docs/zh/start" target="_blank" rel="noreferrer">
        {t('magpieDocs')}
      </a>
    </section>
  )
}
