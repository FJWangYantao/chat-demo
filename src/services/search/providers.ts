import { create } from 'zustand'
import { useSettings } from '../settings.js'
import {
  SEARCH_PROVIDER_IDS,
  type SearchConfig,
  type SearchProviderId,
  type SearchProviderProfile,
  type SearchSettings,
} from './types.js'

const STORAGE_KEY = 'chat-demo:search-providers'

export const SEARCH_PROVIDER_DEFAULTS: Record<
  SearchProviderId,
  Omit<SearchProviderProfile, 'provider' | 'token'>
> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', maxResults: 8 },
  tavily: { baseUrl: 'https://api.tavily.com', maxResults: 8 },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isProvider = (value: unknown): value is SearchProviderId =>
  SEARCH_PROVIDER_IDS.includes(value as SearchProviderId)

const readSettings = (): SearchSettings => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isRecord(saved) && isRecord(saved.profiles)) {
      const profiles: Record<string, SearchProviderProfile> = {}
      for (const [id, value] of Object.entries(saved.profiles)) {
        if (
          isProvider(id) &&
          isRecord(value) &&
          value.provider === id &&
          typeof value.token === 'string' &&
          typeof value.baseUrl === 'string' &&
          typeof value.maxResults === 'number' &&
          Number.isInteger(value.maxResults) &&
          value.maxResults >= 1 &&
          value.maxResults <= 10
        ) {
          profiles[id] = {
            provider: id,
            token: value.token,
            baseUrl: value.baseUrl,
            maxResults: value.maxResults,
          }
        }
      }
      return {
        active: isProvider(saved.active) ? saved.active : null,
        profiles,
      }
    }
  } catch {
    // 存储不可用时使用内存配置。
  }
  return { active: null, profiles: {} }
}

export const useSearchProviders = create<SearchSettings>(() => readSettings())

const persist = (settings: SearchSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 存储不可用时，配置仅在当前页面生效。
  }
  useSearchProviders.setState(settings)
}

export const getSearchProfile = (provider: SearchProviderId): SearchProviderProfile => {
  const saved = useSearchProviders.getState().profiles[provider]
  const defaults = SEARCH_PROVIDER_DEFAULTS[provider]
  return {
    provider,
    baseUrl: saved?.baseUrl || defaults.baseUrl,
    maxResults: saved?.maxResults ?? defaults.maxResults,
    token:
      saved?.token.trim() ||
      (provider === 'deepseek' ? (useSettings.getState().apiKey?.trim() ?? '') : ''),
  }
}

export const saveSearchProfile = (profile: SearchProviderProfile) => {
  const current = useSearchProviders.getState()
  const normalized: SearchProviderProfile = {
    ...profile,
    token: profile.token.trim(),
    baseUrl: profile.baseUrl.trim().replace(/\/+$/, ''),
    maxResults: Math.max(1, Math.min(10, Math.round(profile.maxResults))),
  }
  persist({
    active: profile.provider,
    profiles: { ...current.profiles, [profile.provider]: normalized },
  })
}

export const setActiveSearchProvider = (active: SearchProviderId | null) => {
  persist({ ...useSearchProviders.getState(), active })
}

export const createSearchConfig = (mode: SearchConfig['mode']): SearchConfig | null => {
  const { active } = useSearchProviders.getState()
  if (!active) {
    return null
  }
  const profile = getSearchProfile(active)
  if (!profile.token || !profile.baseUrl) {
    return null
  }
  return { provider: active, maxResults: profile.maxResults, mode }
}

export const isSearchProviderConfigured = () => createSearchConfig('agent') !== null
