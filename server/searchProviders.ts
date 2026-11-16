import type {
  SearchDocument,
  SearchProviderId,
  SearchResult,
} from '../src/services/search/types.ts'

const RESPONSE_LIMIT = 4 * 1024 * 1024
const RESULT_CONTENT_LIMIT = 16000
const DOCUMENT_CONTENT_LIMIT = 100000

export class SearchProviderError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SearchProviderError'
    this.status = status
  }
}

type SearchInput = {
  provider: SearchProviderId
  token: string
  baseUrl: string
  query: string
  maxResults: number
  question?: string
  signal: AbortSignal
}

type FetchInput = Omit<SearchInput, 'maxResults' | 'query'> & { url: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])

export const normalizeSearchBaseUrl = (value: string): string => {
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === 'http:' && !localHostnames.has(url.hostname))
  ) {
    throw new SearchProviderError(400, 'Use an HTTPS search API URL, or HTTP on localhost.')
  }
  return value.replace(/\/+$/, '')
}

const normalizeWebUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 8192) {
    return null
  }
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export const normalizeFetchUrl = (value: string): string => {
  const url = normalizeWebUrl(value)
  if (!url) {
    throw new SearchProviderError(400, 'Enter a valid HTTP or HTTPS URL without credentials.')
  }
  return url
}

const text = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.slice(0, limit) : ''

const nullableText = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim() ? value.slice(0, limit) : null

const upstreamError = (status: number, operation: 'search' | 'fetch') => {
  const action = operation === 'search' ? 'Search' : 'Webpage extraction'
  const messages: Record<number, string> = {
    400: `The ${action.toLowerCase()} request was rejected.`,
    401: 'The search service API key is invalid or expired.',
    402: 'The search service account has insufficient balance.',
    403: 'The search service rejected this request.',
    404:
      operation === 'fetch'
        ? 'No readable webpage content was found.'
        : `${action} is unavailable at this address.`,
    408: `${action} timed out.`,
    413: `${action} exceeded an upstream size limit.`,
    429: 'The search service rate limit was reached.',
  }
  return new SearchProviderError(status, messages[status] ?? `${action} failed (HTTP ${status}).`)
}

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })

const readJson = async (response: Response): Promise<unknown> => {
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
    throw new SearchProviderError(502, 'The search service returned an invalid response.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > RESPONSE_LIMIT) {
        throw new SearchProviderError(502, 'The search service response was too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new SearchProviderError(502, 'The search service returned invalid JSON.')
  }
}

const requestJson = async (
  url: string,
  token: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  operation: 'search' | 'fetch'
): Promise<unknown> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    const timeout = setTimeout(() => controller.abort(), operation === 'search' ? 30000 : 60000)
    signal.addEventListener('abort', abort, { once: true })
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      })
      if (response.ok) {
        return await readJson(response)
      }
    } catch (error) {
      if (error instanceof SearchProviderError) {
        throw error
      }
      signal.throwIfAborted()
      if (controller.signal.aborted) {
        throw new SearchProviderError(504, 'The search service request timed out.')
      }
      if (attempt === 0) {
        await wait(500, signal)
        continue
      }
      throw new SearchProviderError(
        502,
        error instanceof Error && error.message === 'fetch failed'
          ? 'Unable to connect to the search service.'
          : 'The search service request failed.'
      )
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (retryable && attempt === 0) {
        const header = response.headers.get('retry-after')
        const retryAfter = header === null ? NaN : Number(header)
        await wait(
          Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(2000, retryAfter * 1000) : 500,
          signal
        )
        continue
      }
      throw upstreamError(response.status, operation)
    }
  }
  throw new SearchProviderError(502, 'The search service request failed.')
}

const searchResult = (value: unknown, deepseek: boolean): SearchResult | null => {
  if (!isRecord(value)) {
    return null
  }
  const url = normalizeWebUrl(value.url)
  if (!url) {
    return null
  }
  const snippet = text(deepseek ? value.snippet : value.content, 4000)
  const content = text(
    deepseek ? value.summary || value.content || value.snippet : value.content,
    RESULT_CONTENT_LIMIT
  )
  return {
    url,
    title: text(value.title, 2048) || url,
    snippet,
    content,
    siteName: nullableText(deepseek ? value.site_name : value.site_name, 512),
    siteIcon: normalizeWebUrl(deepseek ? value.site_icon : value.favicon),
    publishedAt: nullableText(deepseek ? value.date : value.published_date, 128),
  }
}

export const executeSearch = async (input: SearchInput): Promise<SearchResult[]> => {
  const baseUrl = normalizeSearchBaseUrl(input.baseUrl)
  const deepseek = input.provider === 'deepseek'
  const body = deepseek
    ? {
        query: input.query,
        count: input.maxResults,
        need_content: false,
        ...(input.question ? { ori_question: input.question } : {}),
      }
    : {
        query: input.query,
        search_depth: 'basic',
        max_results: input.maxResults,
        include_answer: false,
        include_raw_content: false,
        include_favicon: true,
        include_published_date: true,
      }
  const value = await requestJson(
    `${baseUrl}${deepseek ? '/v1/tools/search' : '/search'}`,
    input.token,
    body,
    input.signal,
    'search'
  )
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new SearchProviderError(502, 'The search service returned an invalid result list.')
  }
  return value.results
    .slice(0, input.maxResults)
    .map((item) => searchResult(item, deepseek))
    .filter((item): item is SearchResult => item !== null)
}

export const executeFetch = async (input: FetchInput): Promise<SearchDocument> => {
  const baseUrl = normalizeSearchBaseUrl(input.baseUrl)
  const url = normalizeFetchUrl(input.url)
  const deepseek = input.provider === 'deepseek'
  const value = await requestJson(
    `${baseUrl}${deepseek ? '/v1/tools/fetch' : '/extract'}`,
    input.token,
    deepseek
      ? { url }
      : {
          urls: [url],
          format: 'markdown',
          extract_depth: 'basic',
          include_favicon: true,
          include_published_date: true,
          ...(input.question ? { query: input.question } : {}),
        },
    input.signal,
    'fetch'
  )
  const item = deepseek
    ? value
    : isRecord(value) && Array.isArray(value.results)
      ? value.results[0]
      : null
  if (!isRecord(item)) {
    if (!deepseek && isRecord(value) && Array.isArray(value.results)) {
      throw upstreamError(404, 'fetch')
    }
    throw new SearchProviderError(502, 'The search service returned an invalid webpage.')
  }
  const content = text(deepseek ? item.content : item.raw_content, DOCUMENT_CONTENT_LIMIT)
  if (!content.trim()) {
    throw new SearchProviderError(404, 'No readable webpage content was found.')
  }
  return {
    url: normalizeWebUrl(item.url) ?? url,
    title: text(item.title, 2048) || url,
    content,
    siteName: nullableText(item.site_name, 512),
    siteIcon: normalizeWebUrl(deepseek ? item.site_icon : item.favicon),
    publishedAt: nullableText(deepseek ? item.date : item.published_date, 128),
  }
}
