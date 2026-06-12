import type { IncomingMessage } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestUrlFromNodeRequestMock, validateHostHeaderMock } = vi.hoisted(
  () => ({
    requestUrlFromNodeRequestMock: vi.fn(),
    validateHostHeaderMock: vi.fn()
  })
)

vi.mock('./proxy-resolution.js', () => ({
  requestUrlFromNodeRequest: requestUrlFromNodeRequestMock
}))

vi.mock('./http-security.js', () => ({
  validateHostHeader: validateHostHeaderMock
}))

import {
  controlEndpointResponse,
  protectedResourceMetadataPath
} from './http-control-endpoints.js'

beforeEach(() => {
  requestUrlFromNodeRequestMock.mockReset()
  validateHostHeaderMock.mockReset()
  validateHostHeaderMock.mockReturnValue(undefined)
})

describe('controlEndpointResponse', () => {
  it('ignores non-GET requests', () => {
    const response = controlEndpointResponse(
      createRequest({ method: 'POST', headers: {} }),
      runtimeOptions(),
      false
    )

    expect(response).toBeUndefined()
  })

  it('returns a host validation error before any control endpoint response', async () => {
    requestUrlFromNodeRequestMock.mockReturnValue('http://runtime.test/healthz')
    validateHostHeaderMock.mockReturnValue('Host "evil.example" is not allowed.')

    const response = controlEndpointResponse(
      createRequest({
        method: 'GET',
        headers: {
          host: 'evil.example',
          'x-forwarded-host': ['edge.example', 'ignored.example'],
          'x-empty': undefined
        }
      }),
      runtimeOptions(),
      false
    )

    expect(validateHostHeaderMock).toHaveBeenCalledWith(
      expect.any(Request),
      ['runtime.test']
    )
    const request = validateHostHeaderMock.mock.calls[0]?.[0] as Request
    expect(request.headers.get('x-forwarded-host')).toBe(
      'edge.example, ignored.example'
    )
    expect(request.headers.get('x-empty')).toBeNull()
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      error: { message: 'Host "evil.example" is not allowed.' }
    })
  })

  it('serves health and readiness endpoints only for matching paths', async () => {
    requestUrlFromNodeRequestMock
      .mockReturnValueOnce('http://runtime.test/healthz')
      .mockReturnValueOnce('http://runtime.test/readyz')
      .mockReturnValueOnce('http://runtime.test/readyz')
      .mockReturnValueOnce('http://runtime.test/other')

    const health = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions(),
      false
    )
    const draining = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions(),
      true
    )
    const ready = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions(),
      false
    )
    const none = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      {
        ...runtimeOptions(),
        healthPath: false,
        readinessPath: false
      },
      false
    )

    expect(health?.status).toBe(200)
    await expect(health?.json()).resolves.toEqual({ status: 'ok' })
    expect(draining?.status).toBe(503)
    await expect(draining?.json()).resolves.toEqual({ status: 'draining' })
    expect(ready?.status).toBe(200)
    await expect(ready?.json()).resolves.toEqual({ status: 'ready' })
    expect(none).toBeUndefined()
  })

  it('serves protected resource metadata only for authenticated metadata paths', async () => {
    requestUrlFromNodeRequestMock
      .mockReturnValueOnce('https://runtime.test/.well-known/oauth-protected-resource/mcp?foo=1#frag')
      .mockReturnValueOnce('https://runtime.test/.well-known/oauth-protected-resource/other')
      .mockReturnValueOnce('https://runtime.test/.well-known/oauth-protected-resource/mcp')
      .mockReturnValueOnce('https://runtime.test/.well-known/oauth-protected-resource/mcp')
      .mockReturnValueOnce('https://runtime.test/.well-known/oauth-protected-resource/mcp')

    const metadata = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions({
        auth: {
          verifyBearerToken: async () => ({ scopes: [] }),
          metadata: {
            authorizationServers: ['https://auth.example/.well-known/oauth'],
            scopesSupported: ['users:read'],
            resourceName: 'Runtime API',
            serviceDocumentationUrl: 'https://docs.example/runtime'
          }
        }
      }),
      false
    )
    const wrongPath = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions({
        auth: {
          verifyBearerToken: async () => ({ scopes: [] }),
          metadata: {}
        }
      }),
      false
    )
    const authDisabled = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions({ auth: false }),
      false
    )
    const minimalMetadata = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions({
        auth: {
          verifyBearerToken: async () => ({ scopes: [] }),
          metadata: {}
        }
      }),
      false
    )
    const metadataMissing = controlEndpointResponse(
      createRequest({ method: 'GET', headers: {} }),
      runtimeOptions({
        auth: {
          verifyBearerToken: async () => ({ scopes: [] })
        }
      }),
      false
    )

    expect(metadata?.status).toBe(200)
    await expect(metadata?.json()).resolves.toEqual({
      resource: 'https://runtime.test/mcp',
      authorization_servers: ['https://auth.example/.well-known/oauth'],
      scopes_supported: ['users:read'],
      resource_name: 'Runtime API',
      resource_documentation: 'https://docs.example/runtime',
      bearer_methods_supported: ['header']
    })
    expect(wrongPath).toBeUndefined()
    expect(authDisabled).toBeUndefined()
    await expect(minimalMetadata?.json()).resolves.toEqual({
      resource: 'https://runtime.test/mcp',
      bearer_methods_supported: ['header']
    })
    expect(metadataMissing).toBeUndefined()
  })
})

describe('protectedResourceMetadataPath', () => {
  it('prefixes the request path with the metadata well-known route', () => {
    expect(protectedResourceMetadataPath('/mcp')).toBe(
      '/.well-known/oauth-protected-resource/mcp'
    )
  })
})

function runtimeOptions(overrides: Record<string, unknown> = {}) {
  return {
    trustedProxies: ['127.0.0.1'],
    allowedHosts: ['runtime.test'],
    healthPath: '/healthz',
    readinessPath: '/readyz',
    path: '/mcp',
    auth: undefined,
    ...overrides
  }
}

function createRequest({
  method,
  headers
}: {
  method: string
  headers: Record<string, string | string[] | undefined>
}): IncomingMessage {
  return {
    method,
    headers
  } as IncomingMessage
}
