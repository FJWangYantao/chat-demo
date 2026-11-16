import { create } from 'zustand'
import { useSettings } from './settings.js'

import {
  CUSTOM_PROVIDER,
  NATIVE_PROVIDER,
  type CatalogProvider,
  type ModelConfiguration,
  type ProviderProfile,
} from './api/providerTypes.js'
export * from './api/providerTypes.js'

const STORAGE_KEY = 'chat-demo:providers'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const nativeConfiguration = (model = 'deepseek-flash'): ModelConfiguration => ({
  provider: NATIVE_PROVIDER,
  model,
  baseUrl: '',
  api: 'deepseek-native',
  reasoning: true,
  imageInput: true,
})

const readProfiles = (): { active: string; profiles: Record<string, ProviderProfile> } => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isRecord(saved) && isRecord(saved.profiles)) {
      const profiles: Record<string, ProviderProfile> = Object.create(null)
      for (const [id, value] of Object.entries(saved.profiles)) {
        if (
          /^[a-z0-9-]+$/.test(id) &&
          isRecord(value) &&
          value.provider === id &&
          typeof value.model === 'string' &&
          typeof value.apiKey === 'string' &&
          typeof value.baseUrl === 'string' &&
          typeof value.api === 'string' &&
          typeof value.reasoning === 'boolean' &&
          typeof value.imageInput === 'boolean' &&
          (value.toolCalling === undefined || typeof value.toolCalling === 'boolean')
        ) {
          profiles[id] = value as ProviderProfile
        }
      }
      const active =
        typeof saved.active === 'string' && Object.hasOwn(profiles, saved.active)
          ? saved.active
          : NATIVE_PROVIDER
      return { active, profiles }
    }
  } catch {
    // 存储不可用时使用内存配置。
  }
  return { active: NATIVE_PROVIDER, profiles: {} }
}

export const useProviders = create<{
  active: string
  profiles: Record<string, ProviderProfile>
  catalog: CatalogProvider[]
  loading: boolean
  available: boolean | null
}>(() => ({ ...readProfiles(), catalog: [], loading: false, available: null }))

export const getActiveModelConfiguration = (): ModelConfiguration => {
  const { active, profiles } = useProviders.getState()
  if (active === NATIVE_PROVIDER) {
    return nativeConfiguration(profiles[NATIVE_PROVIDER]?.model)
  }
  const profile = profiles[active]
  if (!profile) {
    return nativeConfiguration()
  }
  return {
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl,
    api: profile.api,
    reasoning: profile.reasoning,
    imageInput: profile.imageInput,
    toolCalling: profile.toolCalling,
  }
}

export const getProviderApiKey = (configuration: ModelConfiguration) => {
  if (configuration.provider === NATIVE_PROVIDER) {
    return useSettings.getState().apiKey ?? ''
  }
  const profile = useProviders.getState().profiles[configuration.provider]
  return profile?.baseUrl === configuration.baseUrl ? profile.apiKey : ''
}

export const isChatConfigured = () => {
  const configuration = getActiveModelConfiguration()
  return Boolean(
    configuration.model.trim() &&
    (getProviderApiKey(configuration).trim() ||
      (configuration.provider === CUSTOM_PROVIDER && configuration.baseUrl.trim()))
  )
}

export const saveProviderProfile = (profile: ProviderProfile) => {
  const normalized = {
    ...profile,
    model: profile.model.trim(),
    apiKey: profile.apiKey.trim(),
    baseUrl: profile.baseUrl.trim().replace(/\/+$/, ''),
  }
  const profiles = { ...useProviders.getState().profiles, [profile.provider]: normalized }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: profile.provider, profiles }))
  } catch {
    // 存储不可用时，配置仅在当前页面生效。
  }
  useProviders.setState({ active: profile.provider, profiles })
}

let catalogRequest: Promise<void> | undefined
export const loadProviderCatalog = (): Promise<void> => {
  if (catalogRequest) {
    return catalogRequest
  }
  useProviders.setState({ loading: true })
  catalogRequest = (async () => {
    try {
      const response = await fetch('/api/ai/providers', {
        headers: { 'X-Chat-Demo-Request': '1' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
        throw new Error('provider_catalog_unavailable')
      }
      const body: unknown = await response.json()
      if (!isRecord(body) || !Array.isArray(body.providers)) {
        throw new Error('provider_catalog_invalid')
      }
      useProviders.setState({ catalog: body.providers as CatalogProvider[], available: true })
    } catch {
      useProviders.setState({ available: false })
    } finally {
      useProviders.setState({ loading: false })
      catalogRequest = undefined
    }
  })()
  return catalogRequest
}
