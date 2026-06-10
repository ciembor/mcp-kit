import type { IncomingMessage } from 'node:http'

export function requestUrlFromNodeRequest(
  req: IncomingMessage,
  trustedProxies: readonly string[]
): string {
  const forwarded =
    isTrustedProxy(req, trustedProxies) ? forwardedOrigin(req) : undefined
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
  return trustedProxies.some((proxy) => normalizeAddress(proxy) === remoteAddress)
}

function forwardedOrigin(
  req: IncomingMessage
): { proto?: string; host?: string } | undefined {
  const forwarded = req.headers['forwarded']
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]
    const proto = forwardedParameter(first, 'proto')
    const host = forwardedParameter(first, 'host')
    if (proto !== undefined || host !== undefined) {
      return {
        ...(proto === undefined ? {} : { proto }),
        ...(host === undefined ? {} : { host })
      }
    }
  }

  const host = headerValue(req.headers['x-forwarded-host'])
  const proto = headerValue(req.headers['x-forwarded-proto'])
  if (host !== undefined || proto !== undefined) {
    return {
      ...(host === undefined ? {} : { host }),
      ...(proto === undefined ? {} : { proto })
    }
  }

  return undefined
}

function forwardedParameter(
  value: string | undefined,
  name: string
): string | undefined {
  if (value === undefined) return undefined
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
