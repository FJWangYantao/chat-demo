import { create } from 'zustand'
import { translate } from '../../i18n/index.js'
import {
  MAGPIE_BASE_URL,
  MAGPIE_LOCAL_KEY,
  MAGPIE_PROVIDER,
  PROVIDER_APIS,
  saveProviderProfile,
  useProviders,
  type CatalogModel,
} from '../providers.js'

class MagpieError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCatalogModel = (value: unknown): value is CatalogModel =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  !!value.id &&
  value.id.length <= 512 &&
  typeof value.name === 'string' &&
  value.name.length <= 512 &&
  value.provider === MAGPIE_PROVIDER &&
  typeof value.baseUrl === 'string' &&
  !!value.baseUrl &&
  typeof value.api === 'string' &&
  PROVIDER_APIS.some((api) => api === value.api) &&
  typeof value.reasoning === 'boolean' &&
  typeof value.imageInput === 'boolean'

export const useMagpie = create<{
  models: CatalogModel[]
  baseUrl: string
  checked: boolean
  connected: boolean
  loading: boolean
  error: string
}>(() => ({
  models: [],
  baseUrl: MAGPIE_BASE_URL,
  checked: false,
  connected: false,
  loading: false,
  error: '',
}))

export const magpieConnectionStatus = (
  state: ReturnType<typeof useMagpie.getState>,
  active = false
) => {
  if (state.loading) {
    return state.connected ? ('connectorRefreshing' as const) : ('connectorChecking' as const)
  }
  if (!state.connected) {
    return state.checked ? ('connectorUnavailable' as const) : ('connectorNotChecked' as const)
  }
  return active ? ('connectorEnabled' as const) : ('connectorConnected' as const)
}

let catalogRequest: Promise<void> | undefined

export const loadMagpieModels = (): Promise<void> => {
  if (catalogRequest) {
    return catalogRequest
  }
  useMagpie.setState({ loading: true, error: '' })
  catalogRequest = (async () => {
    try {
      const response = await fetch('/api/magpie/models', {
        headers: { 'X-Chat-Demo-Request': '1' },
        credentials: 'same-origin',
        signal: AbortSignal.timeout(10000),
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        const code = isRecord(body) && typeof body.error === 'string' ? body.error : ''
        const key =
          code === 'magpie_unauthorized'
            ? 'magpieUnauthorized'
            : code === 'magpie_gateway_error'
              ? 'magpieGatewayError'
              : code === 'magpie_invalid_response'
                ? 'magpieInvalidResponse'
                : code === 'magpie_local_only'
                  ? 'magpieLocalOnly'
                  : 'magpieUnavailable'
        throw new MagpieError(translate(key))
      }
      if (
        !isRecord(body) ||
        typeof body.baseUrl !== 'string' ||
        !body.baseUrl ||
        !Array.isArray(body.models) ||
        !body.models.every(isCatalogModel)
      ) {
        throw new MagpieError(translate('magpieInvalidResponse'))
      }
      useMagpie.setState({
        models: body.models,
        baseUrl: body.baseUrl,
        checked: true,
        connected: true,
        error: '',
      })
    } catch (error) {
      useMagpie.setState({
        checked: true,
        connected: false,
        error: error instanceof MagpieError ? error.message : translate('magpieNetworkError'),
      })
    } finally {
      useMagpie.setState({ loading: false })
      catalogRequest = undefined
    }
  })()
  return catalogRequest
}

export const saveMagpieModel = (model: string) => {
  const state = useMagpie.getState()
  const id = model.trim()
  if (!state.connected || !id) {
    throw new MagpieError(translate('magpieSelectModel'))
  }
  const definition = state.models.find((item) => item.id === id)
  const previous = useProviders.getState().profiles[MAGPIE_PROVIDER]
  const samePrevious = previous?.model === id ? previous : undefined
  saveProviderProfile({
    provider: MAGPIE_PROVIDER,
    model: id,
    apiKey: MAGPIE_LOCAL_KEY,
    baseUrl: definition?.baseUrl ?? state.baseUrl,
    api: definition?.api ?? 'openai-completions',
    reasoning: definition?.reasoning ?? samePrevious?.reasoning ?? false,
    imageInput: definition?.imageInput ?? samePrevious?.imageInput ?? false,
  })
}
