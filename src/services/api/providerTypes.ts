export const NATIVE_PROVIDER = 'deepseek-native'
export const CUSTOM_PROVIDER = 'custom'
export const PROVIDER_APIS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const
export type ProviderApi = (typeof PROVIDER_APIS)[number]

export type ModelConfiguration = {
  provider: string
  model: string
  baseUrl: string
  api: string
  reasoning: boolean
  imageInput: boolean
}
export type ProviderProfile = ModelConfiguration & { apiKey: string }
export type CatalogModel = Omit<ModelConfiguration, 'model'> & { id: string; name: string }
export type CatalogProvider = { id: string; name: string; models: CatalogModel[] }
