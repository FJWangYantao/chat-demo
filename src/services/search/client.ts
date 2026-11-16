import { ApiError, request } from '../api/client.js'
import { translate } from '../../i18n/index.js'
import { getSearchProfile } from './providers.js'
import type { SearchConfig, SearchDocument, SearchResult } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-Chat-Demo-Request': '1',
})

const configRequest = (config: SearchConfig, question: string) => {
  const profile = getSearchProfile(config.provider)
  if (!profile.token) {
    throw new ApiError('http', 'searchMissingKey', 401)
  }
  return {
    provider: config.provider,
    baseUrl: profile.baseUrl,
    maxResults: config.maxResults,
    question,
    token: profile.token,
  }
}

export const searchWeb = async (
  config: SearchConfig,
  query: string,
  question: string,
  signal: AbortSignal
): Promise<SearchResult[]> => {
  const { token, ...body } = configRequest(config, question)
  const response = await request('/api/search/search', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ ...body, query }),
    signal,
  })
  const value: unknown = await response.json()
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new ApiError('protocol', 'searchInvalidResponse')
  }
  return value.results as SearchResult[]
}

export const fetchWeb = async (
  config: SearchConfig,
  url: string,
  question: string,
  signal: AbortSignal
): Promise<SearchDocument> => {
  const { token, ...body } = configRequest(config, question)
  const response = await request('/api/search/fetch', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ ...body, url }),
    signal,
  })
  const value: unknown = await response.json()
  if (!isRecord(value) || !isRecord(value.document)) {
    throw new ApiError('protocol', 'searchInvalidResponse')
  }
  return value.document as unknown as SearchDocument
}

export const describeSearchError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return translate('searchUnauthorized')
    }
    if (error.status === 402) {
      return translate('searchInsufficientBalance')
    }
    if (error.status === 429) {
      return translate('searchRateLimited')
    }
    if (error.status === 408 || error.status === 504) {
      return translate('searchTimeout')
    }
    return error.message || translate('searchRequestFailed')
  }
  return error instanceof Error ? error.message : translate('searchRequestFailed')
}
