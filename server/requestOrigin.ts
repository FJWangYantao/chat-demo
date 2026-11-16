import type { IncomingMessage } from 'node:http'

const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])

export const isLocalHostname = (hostname: string) => localHostnames.has(hostname)

const isLoopbackAlias = (origin: URL, candidate: URL) =>
  isLocalHostname(origin.hostname) &&
  isLocalHostname(candidate.hostname) &&
  candidate.port === origin.port

export const isSameOriginAlias = (origin: URL, value: string | undefined) => {
  if (value === undefined) {
    return false
  }
  try {
    const candidate = new URL(value)
    return candidate.origin === origin.origin || isLoopbackAlias(origin, candidate)
  } catch {
    return false
  }
}

export const isTrustedRequestOrigin = (request: IncomingMessage, origin: URL) => {
  let host: URL | null
  try {
    host = new URL(`http://${request.headers.host}`)
  } catch {
    return false
  }
  const trustedHost = host.host === origin.host || isLoopbackAlias(origin, host)
  const trustedOrigin = !request.headers.origin || isSameOriginAlias(origin, request.headers.origin)
  return trustedHost && trustedOrigin
}
