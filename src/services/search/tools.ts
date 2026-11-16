import type { ToolDefinition } from '../api/types.js'

const SEARCH_TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description:
      'Search the public web for current or missing information. Use a concise query of at most 128 Unicode characters. Cite returned source IDs in the final answer.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 128 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'web_fetch',
    description:
      'Read one public HTTP or HTTPS webpage as Markdown. Use this for a URL supplied by the user or returned by web_search. Cite the returned source ID.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri', maxLength: 8192 },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
]

export const getSearchTools = (): ToolDefinition[] => SEARCH_TOOLS
export const isSearchTool = (name: string) => name === 'web_search' || name === 'web_fetch'
