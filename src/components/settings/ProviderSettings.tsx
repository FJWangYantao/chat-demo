import { useEffect, useId, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useMagpie } from '../../services/apps/magpieConnection.js'
import {
  CUSTOM_PROVIDER,
  MAGPIE_BASE_URL,
  MAGPIE_LOCAL_KEY,
  MAGPIE_PROVIDER,
  NATIVE_PROVIDER,
  PROVIDER_APIS,
  getActiveModelConfiguration,
  loadProviderCatalog,
  nativeConfiguration,
  saveProviderProfile,
  useProviders,
  type CatalogProvider,
  type ProviderProfile,
} from '../../services/providers.js'
import { setApiKey, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import styles from './ProviderSettings.module.css'

export const ProviderSettings = () => {
  const t = useTranslate()
  const catalog = useProviders((state) => state.catalog)
  const magpieModels = useMagpie((state) => state.models)
  const profiles = useProviders((state) => state.profiles)
  const active = useProviders((state) => state.active)
  const available = useProviders((state) => state.available)
  const loading = useProviders((state) => state.loading)
  const [selected, setSelected] = useState(active)
  const id = useId()
  useEffect(() => {
    void loadProviderCatalog()
  }, [])
  const native: CatalogProvider = {
    id: NATIVE_PROVIDER,
    name: t('providerNative'),
    models: ['deepseek-flash', 'deepseek-v4-pro'].map((model) => ({
      ...nativeConfiguration(model),
      id: model,
      name: model,
    })),
  }
  const choices = [
    native,
    { id: MAGPIE_PROVIDER, name: 'Magpie', models: magpieModels },
    ...catalog,
    { id: CUSTOM_PROVIDER, name: t('providerCustom'), models: [] },
  ]
  for (const profile of Object.values(profiles)) {
    if (!choices.some((item) => item.id === profile.provider)) {
      choices.push({ id: profile.provider, name: profile.provider, models: [] })
    }
  }
  const provider = choices.find((item) => item.id === selected) ?? native
  const configuration = getActiveModelConfiguration()
  return (
    <div className={styles.settings}>
      <h2>{t('settingsProviders')}</h2>
      <p>{t('providerDescription')}</p>
      <p className={styles.current}>
        {t('providerCurrent', {
          model: `${choices.find((item) => item.id === active)?.name ?? active} · ${configuration.model}`,
        })}
      </p>
      {available === false ? (
        <div className={styles.notice} role="status">
          {t('providerServerUnavailable')}
          <Button
            size="s"
            variant="outlined"
            disabled={loading}
            onClick={() => void loadProviderCatalog()}
          >
            {t('retry')}
          </Button>
        </div>
      ) : null}
      <label htmlFor={`${id}-provider`}>{t('providerLabel')}</label>
      <select
        id={`${id}-provider`}
        name="provider"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        {choices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
            {profiles[item.id] ? ` · ${t('providerConfigured')}` : ''}
          </option>
        ))}
      </select>
      <ProfileEditor key={selected} provider={provider} profile={profiles[selected]} />
    </div>
  )
}

const ProfileEditor = ({
  provider,
  profile,
}: {
  provider: CatalogProvider
  profile?: ProviderProfile
}) => {
  const t = useTranslate()
  const id = useId()
  const native = provider.id === NATIVE_PROVIDER
  const custom = provider.id === CUSTOM_PROVIDER
  const magpie = provider.id === MAGPIE_PROVIDER
  const nativeKey = useSettings((state) => state.apiKey)
  const first = provider.models[0]
  const [model, setModel] = useState(profile?.model ?? first?.id ?? '')
  const [apiKey, setKey] = useState(
    native ? (nativeKey ?? '') : (profile?.apiKey ?? (magpie ? MAGPIE_LOCAL_KEY : ''))
  )
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? (magpie ? MAGPIE_BASE_URL : ''))
  const [api, setApi] = useState(profile?.api ?? first?.api ?? 'openai-completions')
  const [reasoning, setReasoning] = useState(profile?.reasoning ?? first?.reasoning ?? false)
  const [imageInput, setImageInput] = useState(profile?.imageInput ?? first?.imageInput ?? false)
  const [toolCalling, setToolCalling] = useState(profile?.toolCalling ?? true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const known = provider.models.find((item) => item.id === model)
  const changeModel = (value: string) => {
    setSaved(false)
    setModel(value)
    const match = provider.models.find((item) => item.id === value)
    if (match) {
      setApi(match.api)
      setReasoning(match.reasoning)
      setImageInput(match.imageInput)
      setToolCalling(match.toolCalling ?? true)
    }
  }
  return (
    <form
      className={styles.form}
      onChange={() => setSaved(false)}
      onSubmit={(event) => {
        event.preventDefault()
        setError('')
        if (baseUrl.trim()) {
          try {
            const url = new URL(baseUrl.trim())
            if (
              !['https:', 'http:'].includes(url.protocol) ||
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              (url.protocol === 'http:' &&
                !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
            ) {
              throw new Error()
            }
          } catch {
            setError(t('providerInvalidUrl'))
            return
          }
        }
        if (native) {
          setApiKey(apiKey.trim() || null)
        }
        saveProviderProfile({
          provider: provider.id,
          model,
          apiKey: native ? '' : apiKey,
          baseUrl: native ? '' : baseUrl,
          api: known?.api ?? api,
          reasoning: known?.reasoning ?? reasoning,
          imageInput: known?.imageInput ?? imageInput,
          toolCalling: known?.toolCalling ?? toolCalling,
        })
        setSaved(true)
      }}
    >
      <label htmlFor={`${id}-model`}>{t('providerModel')}</label>
      <input
        id={`${id}-model`}
        name="model-id"
        list={`${id}-models`}
        value={model}
        required
        maxLength={512}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => changeModel(event.target.value)}
        placeholder={custom ? 'model-id' : first?.id}
      />
      <datalist id={`${id}-models`}>
        {provider.models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </datalist>
      {!magpie ? (
        <>
          <label htmlFor={`${id}-key`}>API Key</label>
          <input
            id={`${id}-key`}
            name="api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setKey(event.target.value)}
            required={!custom}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-key-hint`}
          />
          <p id={`${id}-key-hint`}>{t(custom ? 'providerKeyOptional' : 'providerKeyHint')}</p>
        </>
      ) : null}
      {!native ? (
        <>
          <label htmlFor={`${id}-url`}>{t('providerBaseUrl')}</label>
          <input
            id={`${id}-url`}
            name="base-url"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required={custom || magpie}
            readOnly={magpie}
            placeholder={known?.baseUrl ?? 'https://api.example.com/v1'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-url-hint`}
          />
          <p id={`${id}-url-hint`}>{t(magpie ? 'magpieBaseUrlHint' : 'providerBaseUrlHint')}</p>
          {custom || !known ? (
            <>
              <label htmlFor={`${id}-api`}>{t('providerApi')}</label>
              <select
                id={`${id}-api`}
                name="api-protocol"
                value={api}
                disabled={magpie}
                onChange={(event) => setApi(event.target.value)}
              >
                {PROVIDER_APIS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
                {!PROVIDER_APIS.some((value) => value === api) ? (
                  <option value={api}>{api}</option>
                ) : null}
              </select>
              <div className={styles.capabilities}>
                <label htmlFor={`${id}-reasoning`}>
                  <input
                    id={`${id}-reasoning`}
                    name="reasoning"
                    type="checkbox"
                    checked={reasoning}
                    onChange={(event) => setReasoning(event.target.checked)}
                  />
                  {t('providerReasoning')}
                </label>
                <label htmlFor={`${id}-images`}>
                  <input
                    id={`${id}-images`}
                    name="image-input"
                    type="checkbox"
                    checked={imageInput}
                    onChange={(event) => setImageInput(event.target.checked)}
                  />
                  {t('providerImages')}
                </label>
                <label htmlFor={`${id}-tools`}>
                  <input
                    id={`${id}-tools`}
                    name="tool-calling"
                    type="checkbox"
                    checked={toolCalling}
                    onChange={(event) => setToolCalling(event.target.checked)}
                  />
                  {t('providerToolCalling')}
                </label>
              </div>
            </>
          ) : (
            <p>
              {t('providerCapabilities', {
                reasoning: t(known.reasoning ? 'providerSupported' : 'providerUnsupported'),
                images: t(known.imageInput ? 'providerSupported' : 'providerUnsupported'),
              })}
            </p>
          )}
        </>
      ) : (
        <p>{t('providerNativeHint')}</p>
      )}
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit">{t('providerSave')}</Button>
        {saved ? <span role="status">{t('providerSaved')}</span> : null}
      </div>
    </form>
  )
}
