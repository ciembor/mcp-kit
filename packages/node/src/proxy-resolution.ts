import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export function requestUrlFromNodeRequest(
  req: IncomingMessage,
  trustedProxies: readonly string[]
): string {
  const forwarded = isTrustedProxy(req, trustedProxies)
    ? forwardedOrigin(req)
    : undefined
  const host = forwarded?.host ?? req.headers.host ?? '127.0.0.1'
  const protocol = forwarded?.proto ?? localProtocol(req)
  return `${protocol}://${host}${req.url ?? '/'}`
}

export function isTrustedProxy(
  req: IncomingMessage,
  trustedProxies: readonly string[]
): boolean {
  const remoteAddress = normalizeAddress(req.socket.remoteAddress)
  if (remoteAddress === undefined) return false
  return trustedProxies.some((proxy) =>
    proxyMatchesAddress(proxy, remoteAddress)
  )
}

function forwardedOrigin(
  req: IncomingMessage
): { proto?: string; host?: string } | undefined {
  return (
    forwardedHeaderOrigin(req.headers['forwarded']) ?? forwardedProxyOrigin(req)
  )
}

function forwardedHeaderOrigin(
  forwarded: string | string[] | undefined
): { proto?: string; host?: string } | undefined {
  if (typeof forwarded !== 'string') return undefined
  const first = forwarded.split(',')[0]!
  return originParts(
    forwardedParameter(first, 'proto'),
    forwardedParameter(first, 'host')
  )
}

function forwardedProxyOrigin(
  req: IncomingMessage
): { proto?: string; host?: string } | undefined {
  return originParts(
    headerValue(req.headers['x-forwarded-proto']),
    headerValue(req.headers['x-forwarded-host'])
  )
}

function originParts(
  proto: string | undefined,
  host: string | undefined
): { proto?: string; host?: string } | undefined {
  if (proto === undefined && host === undefined) return undefined
  return {
    ...(proto === undefined ? {} : { proto }),
    ...(host === undefined ? {} : { host })
  }
}

function forwardedParameter(value: string, name: string): string | undefined {
  const match = value.match(new RegExp(`${name}=([^;]+)`))
  if (match === null) return undefined
  return match[1]?.replace(/^"|"$/g, '')
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function localProtocol(req: IncomingMessage): 'http' | 'https' {
  return 'encrypted' in req.socket ? 'https' : 'http'
}

function normalizeAddress(address: string | undefined): string | undefined {
  if (address === undefined) return undefined
  if (address.startsWith('::ffff:')) return address.slice(7)
  return address
}

function proxyMatchesAddress(proxy: string, remoteAddress: string): boolean {
  if (!proxy.includes('/')) return normalizeAddress(proxy) === remoteAddress
  const [network, prefixText] = proxy.split('/', 2)
  const prefix = Number(prefixText)
  if (network === undefined || !Number.isInteger(prefix)) return false
  const normalizedNetwork = normalizeAddress(network)
  if (normalizedNetwork === undefined) return false
  const version = isIP(normalizedNetwork)
  if (version !== 4 && version !== 6) return false
  if (isIP(remoteAddress) !== version) return false
  const bits = version === 4 ? 32 : 128
  if (prefix < 0 || prefix > bits) return false
  return (
    addressToBigInt(remoteAddress, version) >> BigInt(bits - prefix) ===
    addressToBigInt(normalizedNetwork, version) >> BigInt(bits - prefix)
  )
}

function addressToBigInt(address: string, version: 4 | 6): bigint {
  if (version === 4) return ipv4ToBigInt(address)
  return ipv6ToBigInt(address)
}

function ipv4ToBigInt(address: string): bigint {
  return address
    .split('.')
    .reduce((value, part) => (value << 8n) + BigInt(Number(part)), 0n)
}

function ipv6ToBigInt(address: string): bigint {
  const [head = '', tail = ''] = address.split('::', 2)
  const headParts = hextets(head)
  const tailParts = hextets(tail)
  const missing = 8 - headParts.length - tailParts.length
  const parts =
    address.includes('::') === true
      ? [
          ...headParts,
          ...Array.from({ length: missing }, () => 0),
          ...tailParts
        ]
      : headParts
  return parts.reduce((value, part) => (value << 16n) + BigInt(part), 0n)
}

function hextets(value: string): number[] {
  if (value === '') return []
  return value.split(':').map((part) => Number.parseInt(part, 16))
}
