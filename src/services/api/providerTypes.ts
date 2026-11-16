export const NATIVE_PROVIDER = 'deepseek-native'
export const CUSTOM_PROVIDER = 'custom'
export const MAGPIE_PROVIDER = 'magpie'
export const MAGPIE_BASE_URL = 'http://127.0.0.1:3425/v1'
export const MAGPIE_LOCAL_KEY = 'magpie'
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
  /** 自定义模型可关闭；缺省按支持工具调用处理，兼容旧配置。 */
  toolCalling?: boolean
}
export type ProviderProfile = ModelConfiguration & { apiKey: string }
export type CatalogModel = Omit<ModelConfiguration, 'model'> & { id: string; name: string }
export type CatalogProvider = { id: string; name: string; models: CatalogModel[] }
