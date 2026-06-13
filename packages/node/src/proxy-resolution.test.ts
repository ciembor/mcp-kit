import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'

import {
  isTrustedProxy,
  requestUrlFromNodeRequest
} from './proxy-resolution.js'

describe('proxy resolution', () => {
  it('uses the local request host and protocol when the proxy is not trusted', () => {
    const request = createRequest({
      url: '/status',
      host: 'local.test',
      remoteAddress: '203.0.113.10',
      headers: {
        forwarded: 'proto=https;host=public.example'
      }
    })

    expect(requestUrlFromNodeRequest(request, ['127.0.0.1'])).toBe(
      'http://local.test/status'
    )
    expect(isTrustedProxy(request, ['127.0.0.1'])).toBe(false)
  })

  it('uses the RFC forwarded header for trusted proxies', () => {
    const request = createRequest({
      url: '/mcp',
      remoteAddress: '::ffff:127.0.0.1',
      headers: {
        forwarded:
          'for=192.0.2.10;proto=https;host="public.example", for=192.0.2.20'
      }
    })

    expect(requestUrlFromNodeRequest(request, ['127.0.0.1'])).toBe(
      'https://public.example/mcp'
    )
    expect(isTrustedProxy(request, ['::ffff:127.0.0.1'])).toBe(true)
  })

  it('matches trusted proxy CIDR ranges', () => {
    const request = createRequest({
      url: '/mcp',
      remoteAddress: '10.0.0.42',
      headers: {
        forwarded: 'proto=https;host=public.example'
      }
    })

    expect(isTrustedProxy(request, ['10.0.0.0/24'])).toBe(true)
    expect(requestUrlFromNodeRequest(request, ['10.0.0.0/24'])).toBe(
      'https://public.example/mcp'
    )
    expect(isTrustedProxy(request, ['10.0.1.0/24'])).toBe(false)
  })

  it('matches trusted IPv6 CIDR ranges', () => {
    const request = createRequest({
      url: '/mcp',
      remoteAddress: '2001:db8::42',
      headers: {
        forwarded: 'proto=https;host=ipv6.example'
      }
    })

    expect(isTrustedProxy(request, ['2001:db8::/64'])).toBe(true)
    expect(requestUrlFromNodeRequest(request, ['2001:db8::/64'])).toBe(
      'https://ipv6.example/mcp'
    )
    expect(isTrustedProxy(request, ['2001:db9::/64'])).toBe(false)
  })

  it('ignores empty forwarded headers from trusted proxies', () => {
    const request = createRequest({
      url: '/mcp',
      remoteAddress: '127.0.0.1',
      headers: {
        host: 'internal.example',
        forwarded: ''
      }
    })

    expect(requestUrlFromNodeRequest(request, ['127.0.0.1'])).toBe(
      'http://internal.example/mcp'
    )
  })

  it('falls back to x-forwarded headers and prefers the first array value', () => {
    const request = createRequest({
      url: '/events',
      remoteAddress: '127.0.0.1',
      headers: {
        forwarded: ['ignored-array-value'],
        'x-forwarded-proto': ['https', 'http'],
        'x-forwarded-host': ['api.example', 'internal.example']
      }
    })

    expect(requestUrlFromNodeRequest(request, ['127.0.0.1'])).toBe(
      'https://api.example/events'
    )
  })

  it('keeps available forwarded parts and falls back for missing ones', () => {
    const protoOnly = createRequest({
      url: '/secure',
      remoteAddress: '127.0.0.1',
      headers: {
        'x-forwarded-proto': 'https'
      }
    })
    const hostOnly = createRequest({
      url: undefined,
      remoteAddress: '127.0.0.1',
      headers: {
        host: 'internal.example',
        forwarded: 'for=192.0.2.10;host=public.example'
      }
    })
    const encryptedHostOnly = createRequest({
      url: '/tls',
      remoteAddress: '127.0.0.1',
      encrypted: true,
      headers: {
        forwarded: 'for=192.0.2.10;host=secure.example'
      }
    })

    expect(requestUrlFromNodeRequest(protoOnly, ['127.0.0.1'])).toBe(
      'https://127.0.0.1/secure'
    )
    expect(requestUrlFromNodeRequest(hostOnly, ['127.0.0.1'])).toBe(
      'http://public.example/'
    )
    expect(requestUrlFromNodeRequest(encryptedHostOnly, ['127.0.0.1'])).toBe(
      'https://secure.example/tls'
    )
  })

  it('returns false when the request has no remote address', () => {
    const request = createRequest({ url: undefined })

    expect(isTrustedProxy(request, ['127.0.0.1'])).toBe(false)
    expect(requestUrlFromNodeRequest(request, ['127.0.0.1'])).toBe(
      'http://127.0.0.1/'
    )
  })

  it('falls back to the local host and url when forwarded metadata is incomplete', () => {
    const request = {
      url: undefined,
      headers: {
        host: 'local.example',
        forwarded: 'for=192.0.2.10'
      },
      socket: { remoteAddress: '127.0.0.1' }
    } as IncomingMessage

    expect(requestUrlFromNodeRequest(request, ['127.0.0.1'])).toBe(
      'http://local.example/'
    )
  })
})

function createRequest({
  url,
  host,
  remoteAddress,
  encrypted = false,
  headers = {}
}: {
  url: string | undefined
  host?: string
  remoteAddress?: string
  encrypted?: boolean
  headers?: Record<string, string | string[] | undefined>
}): IncomingMessage {
  const socket = encrypted
    ? { remoteAddress, encrypted: true }
    : { remoteAddress }
  return {
    url: url === undefined ? '/' : url,
    headers: {
      host,
      ...headers
    },
    socket
  } as IncomingMessage
}
