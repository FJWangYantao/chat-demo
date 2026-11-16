import { useId, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useProviders } from '../../services/providers.js'
import {
  getSearchProfile,
  saveSearchProfile,
  SEARCH_PROVIDER_DEFAULTS,
  setActiveSearchProvider,
  useSearchProviders,
} from '../../services/search/providers.js'
import type { SearchProviderId } from '../../services/search/types.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import styles from './ProviderSettings.module.css'

const providerName = (provider: SearchProviderId) =>
  provider === 'deepseek' ? 'DeepSeek' : 'Tavily'

export const SearchSettings = () => {
  const t = useTranslate()
  const active = useSearchProviders((state) => state.active)
  useSearchProviders((state) => state.profiles)
  const available = useProviders((state) => state.available)
  useSettings((state) => state.apiKey)
  const [selected, setSelected] = useState<SearchProviderId | ''>(active ?? '')
  const id = useId()
  return (
    <div className={styles.settings}>
      <h2>{t('settingsSearch')}</h2>
      <p>{t('searchSettingsDescription')}</p>
      {available === false || window.location.protocol === 'file:' ? (
        <p className={styles.notice} role="status">
          {t('searchServerRequired')}
        </p>
      ) : null}
      <label htmlFor={`${id}-provider`}>{t('searchProviderLabel')}</label>
      <select
        id={`${id}-provider`}
        name="search-provider"
        value={selected}
        onChange={(event) => {
          const value = event.target.value as SearchProviderId | ''
          setSelected(value)
          if (!value) {
            setActiveSearchProvider(null)
          } else if (getSearchProfile(value).token) {
            setActiveSearchProvider(value)
          }
        }}
      >
        <option value="">{t('searchProviderNone')}</option>
        {(['deepseek', 'tavily'] as const).map((provider) => (
          <option key={provider} value={provider}>
            {providerName(provider)}
            {getSearchProfile(provider).token ? ` · ${t('providerConfigured')}` : ''}
          </option>
        ))}
      </select>
      {selected ? <ProfileEditor key={selected} provider={selected} /> : null}
    </div>
  )
}

const ProfileEditor = ({ provider }: { provider: SearchProviderId }) => {
  const t = useTranslate()
  const id = useId()
  const saved = useSearchProviders((state) => state.profiles[provider])
  const nativeKey = useSettings((state) => state.apiKey)
  const defaults = SEARCH_PROVIDER_DEFAULTS[provider]
  const [token, setToken] = useState(saved?.token ?? '')
  const [separateKey, setSeparateKey] = useState(Boolean(saved?.token.trim()))
  const hasNativeKey = provider === 'deepseek' && Boolean(nativeKey?.trim())
  const reuseNativeKey = hasNativeKey && !separateKey
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? defaults.baseUrl)
  const [maxResults, setMaxResults] = useState(String(saved?.maxResults ?? defaults.maxResults))
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<'token' | 'url' | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  return (
    <form
      className={styles.form}
      onChange={() => {
        setSavedNotice(false)
        setError('')
        setErrorField(null)
      }}
      onSubmit={(event) => {
        event.preventDefault()
        setError('')
        setErrorField(null)
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
          setErrorField('url')
          event.currentTarget.querySelector<HTMLInputElement>('[name="search-base-url"]')?.focus()
          return
        }
        if (!reuseNativeKey && !token.trim()) {
          setError(t('searchNotConfigured'))
          setErrorField('token')
          event.currentTarget.querySelector<HTMLInputElement>('[name="search-api-key"]')?.focus()
          return
        }
        saveSearchProfile({
          provider,
          token,
          baseUrl,
          maxResults: Number(maxResults),
        })
        setSavedNotice(true)
      }}
    >
      {reuseNativeKey ? (
        <div className={styles.notice}>
          <p id={`${id}-token-hint`} role="status">
            {t('searchDeepseekKeyReused')}
          </p>
          <Button
            variant="outlined"
            size="s"
            onClick={() => {
              setSeparateKey(true)
              setSavedNotice(false)
              setError('')
              setErrorField(null)
            }}
          >
            {t('searchUseSeparateKey')}
          </Button>
        </div>
      ) : (
        <>
          <label htmlFor={`${id}-token`}>{t('searchToken')}</label>
          <input
            id={`${id}-token`}
            name="search-api-key"
            type="password"
            value={token}
            required
            maxLength={4096}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={errorField === 'token' ? true : undefined}
            aria-describedby={`${id}-token-hint${errorField === 'token' ? ` ${id}-error` : ''}`}
            onChange={(event) => setToken(event.target.value)}
          />
          <p id={`${id}-token-hint`}>
            {t(provider === 'deepseek' ? 'searchDeepseekTokenHint' : 'searchTokenHint')}
          </p>
          {hasNativeKey ? (
            <Button
              variant="outlined"
              size="s"
              onClick={() => {
                setSeparateKey(false)
                setToken('')
                setSavedNotice(false)
                setError('')
                setErrorField(null)
              }}
            >
              {t('searchReuseDeepseekKey')}
            </Button>
          ) : null}
        </>
      )}
      <label htmlFor={`${id}-url`}>{t('providerBaseUrl')}</label>
      <input
        id={`${id}-url`}
        name="search-base-url"
        type="url"
        value={baseUrl}
        required
        maxLength={2048}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={errorField === 'url' ? true : undefined}
        aria-describedby={errorField === 'url' ? `${id}-error` : undefined}
        onChange={(event) => setBaseUrl(event.target.value)}
      />
      <label htmlFor={`${id}-max-results`}>{t('searchMaxResults')}</label>
      <input
        id={`${id}-max-results`}
        name="search-max-results"
        type="number"
        min={1}
        max={10}
        step={1}
        required
        value={maxResults}
        onChange={(event) => setMaxResults(event.target.value)}
      />
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit">{t('searchSave')}</Button>
        {savedNotice ? <span role="status">{t('searchSaved')}</span> : null}
      </div>
      <p>{t('searchServerRequired')}</p>
    </form>
  )
}
