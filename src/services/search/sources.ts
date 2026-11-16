import {
  SEARCH_SOURCE_INSTRUCTION,
  type SearchDocument,
  type SearchResult,
  type SearchSource,
  type SearchToolPayload,
} from './types.js'

export const SEARCH_ROUND_CONTENT_LIMIT = 60000
export const SEARCH_DOCUMENT_CONTENT_LIMIT = 24000

const normalizeUrl = (value: string) => {
  const url = new URL(value)
  url.hash = ''
  return url.href
}

export class ReplySourceRegistry {
  private readonly byUrl = new Map<string, SearchSource>()

  constructor(initial: SearchSource[] = []) {
    for (const source of initial) {
      this.byUrl.set(normalizeUrl(source.url), { ...source })
    }
  }

  get list() {
    return [...this.byUrl.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  }

  private add(
    value: SearchResult | SearchDocument,
    snippet: string,
    contentLimit: number
  ): SearchSource {
    const url = normalizeUrl(value.url)
    const previous = this.byUrl.get(url)
    const content = value.content.slice(0, Math.max(0, contentLimit))
    const source: SearchSource = {
      id: previous?.id ?? `S${this.byUrl.size + 1}`,
      url,
      title:
        previous && (!value.title || value.title === url)
          ? previous.title
          : value.title || previous?.title || url,
      snippet: snippet || previous?.snippet || '',
      content: (previous && previous.content.length > content.length
        ? previous.content
        : content || previous?.content || ''
      ).slice(0, Math.max(0, contentLimit)),
      siteName: value.siteName || previous?.siteName || null,
      siteIcon: value.siteIcon || previous?.siteIcon || null,
      publishedAt: value.publishedAt || previous?.publishedAt || null,
    }
    this.byUrl.set(url, source)
    return { ...source }
  }

  addSearch(results: SearchResult[], contentLimit: number): SearchSource[] {
    let remaining = Math.max(0, contentLimit)
    return results.map((result) => {
      const source = this.add(result, result.snippet.slice(0, 4000), remaining)
      remaining = Math.max(0, remaining - source.content.length)
      return source
    })
  }

  addFetch(document: SearchDocument, contentLimit: number): SearchSource {
    return this.add(
      { ...document, snippet: '' },
      this.byUrl.get(normalizeUrl(document.url))?.snippet ?? '',
      Math.min(SEARCH_DOCUMENT_CONTENT_LIMIT, Math.max(0, contentLimit))
    )
  }
}

export const searchToolPayload = (
  type: SearchToolPayload['type'],
  sources: SearchSource[]
): string =>
  JSON.stringify({
    type,
    instruction: SEARCH_SOURCE_INSTRUCTION,
    sources,
  } satisfies SearchToolPayload)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseSearchToolPayload = (content: string): SearchToolPayload | null => {
  try {
    const value: unknown = JSON.parse(content)
    if (
      !isRecord(value) ||
      !['web_search', 'web_fetch'].includes(String(value.type)) ||
      !Array.isArray(value.sources)
    ) {
      return null
    }
    const sources = value.sources.flatMap((item): SearchSource[] => {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        !/^S[1-9]\d*$/.test(item.id) ||
        typeof item.url !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.snippet !== 'string' ||
        typeof item.content !== 'string'
      ) {
        return []
      }
      try {
        new URL(item.url)
      } catch {
        return []
      }
      return [
        {
          id: item.id,
          url: item.url,
          title: item.title,
          snippet: item.snippet,
          content: item.content,
          siteName: typeof item.siteName === 'string' ? item.siteName : null,
          siteIcon: typeof item.siteIcon === 'string' ? item.siteIcon : null,
          publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : null,
        },
      ]
    })
    return {
      type: value.type as SearchToolPayload['type'],
      instruction: typeof value.instruction === 'string' ? value.instruction : '',
      sources,
    }
  } catch {
    return null
  }
}
