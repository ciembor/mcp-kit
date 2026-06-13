import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  SessionStore,
  StreamableHttpAuthOptions
} from './http-contracts.js'

const { createInMemorySessionStoreMock } = vi.hoisted(() => ({
  createInMemorySessionStoreMock: vi.fn()
}))

vi.mock('./session-store.js', () => ({
  createInMemorySessionStore: createInMemorySessionStoreMock
}))

import {
  corsHeaders,
  normalizeStreamableHttpOptions,
  validateHostHeader,
  validateOriginHeader
} from './http-security.js'

beforeEach(() => {
  createInMemorySessionStoreMock.mockReset()
  createInMemorySessionStoreMock.mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(() => Promise.resolve([]))
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalizeStreamableHttpOptions', () => {
  it('builds loopback defaults and freezes derived collections', () => {
    vi.stubEnv('NODE_ENV', 'test')

    const normalized = normalizeStreamableHttpOptions()

    expect(normalized).toMatchObject({
      mode: 'development',
      host: '127.0.0.1',
      port: 3000,
      path: '/mcp',
      healthPath: '/healthz',
      readinessPath: '/readyz',
      sessionMode: 'stateless',
      allowedOrigins: [],
      cors: false,
      maxBodyBytes: 1024 * 1024,
      requestTimeoutMs: 30_000,
      maxConcurrency: 16
    })
    expect(normalized.allowedHosts).toEqual([
      '127.0.0.1',
      '127.0.0.1:3000',
      '127.0.0.1:*',
      'localhost',
      'localhost:3000',
      'localhost:*',
      '[::1]',
      '[::1]:3000',
      '[::1]:*'
    ])
    expect(Object.isFrozen(normalized.allowedHosts)).toBe(true)
    expect(Object.isFrozen(normalized.allowedOrigins)).toBe(true)
    expect(Object.isFrozen(normalized.trustedProxies)).toBe(true)
  })

  it('normalizes explicit stateful options, custom paths and optional adapters', () => {
    const sessionStore: SessionStore = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => Promise.resolve([]))
    }
    const eventStore = { replayEventsAfter: vi.fn(), storeEvent: vi.fn() }
    const auth: StreamableHttpAuthOptions = {
      verifyBearerToken: () => ({ source: 'oauth', scopes: [] as string[] })
    }

    const normalized = normalizeStreamableHttpOptions({
      mode: 'production',
      host: 'api.example',
      port: 8080,
      path: 'custom',
      healthPath: '',
      readinessPath: false,
      sessionMode: 'stateful',
      sessionStore,
      eventStore,
      retryIntervalMs: 2_500,
      auth,
      trustedProxies: ['10.0.0.1'],
      allowedHosts: ['api.example', 'api.example:8080'],
      allowedOrigins: ['https://client.example'],
      cors: {
        allowCredentials: true,
        allowedHeaders: ['Authorization'],
        maxAgeSeconds: 120
      },
      maxBodyBytes: 512,
      requestTimeoutMs: 4_000,
      maxConcurrency: 8
    })

    expect(normalized).toMatchObject({
      mode: 'production',
      host: 'api.example',
      port: 8080,
      path: '/custom',
      healthPath: '/mcp',
      readinessPath: false,
      sessionMode: 'stateful',
      sessionStore,
      eventStore,
      retryIntervalMs: 2_500,
      auth,
      trustedProxies: ['10.0.0.1'],
      allowedHosts: ['api.example', 'api.example:8080'],
      allowedOrigins: ['https://client.example'],
      cors: {
        allowCredentials: true,
        allowedHeaders: ['Authorization'],
        maxAgeSeconds: 120
      },
      maxBodyBytes: 512,
      requestTimeoutMs: 4_000,
      maxConcurrency: 8
    })
  })

  it('creates a development in-memory session store for stateful mode by default', () => {
    vi.stubEnv('NODE_ENV', 'development')

    const normalized = normalizeStreamableHttpOptions({
      sessionMode: 'stateful'
    })

    expect(createInMemorySessionStoreMock).toHaveBeenCalledTimes(1)
    expect(normalized.sessionStore).toBe(
      createInMemorySessionStoreMock.mock.results[0]?.value
    )
  })

  it('uses default cors headers and production mode from NODE_ENV', () => {
    vi.stubEnv('NODE_ENV', 'production')

    const normalized = normalizeStreamableHttpOptions({
      allowedOrigins: ['https://client.example'],
      cors: {}
    })

    expect(normalized.mode).toBe('production')
    expect(normalized.cors).toEqual({
      allowCredentials: false,
      allowedHeaders: [
        'Content-Type',
        'Last-Event-ID',
        'MCP-Protocol-Version',
        'Mcp-Session-Id',
        'Authorization'
      ],
      maxAgeSeconds: 600
    })
  })

  it('rejects unsafe binding, public auth and stateful production defaults', () => {
    expect(() =>
      normalizeStreamableHttpOptions({
        host: '0.0.0.0',
        port: 80
      })
    ).toThrow('explicit deployment mode')

    expect(() =>
      normalizeStreamableHttpOptions({
        mode: 'production',
        host: '0.0.0.0'
      })
    ).toThrow('explicit trusted proxies')

    expect(() =>
      normalizeStreamableHttpOptions({
        mode: 'production',
        host: 'api.example'
      })
    ).toThrow('explicit auth decision')

    expect(() =>
      normalizeStreamableHttpOptions({
        mode: 'production',
        host: 'api.example',
        auth: false,
        sessionMode: 'stateful'
      })
    ).toThrow('explicit SessionStore outside development')
  })

  it('accepts explicit public binding when mode, proxies and auth are all set', () => {
    const normalized = normalizeStreamableHttpOptions({
      mode: 'production',
      host: '0.0.0.0',
      port: 8080,
      trustedProxies: ['10.0.0.1'],
      auth: false
    })

    expect(normalized.allowedHosts).toEqual(['0.0.0.0'])
  })

  it('rejects enabling cors without explicit allowed origins', () => {
    expect(() =>
      normalizeStreamableHttpOptions({
        cors: {}
      })
    ).toThrow('CORS requires explicit allowedOrigins')
  })
})

describe('validateHostHeader', () => {
  it('accepts exact, case-insensitive and explicit any-port matches', () => {
    expect(
      validateHostHeader(
        new Request('http://runtime.test', {
          headers: { host: 'LOCALHOST' }
        }),
        ['localhost']
      )
    ).toBeUndefined()

    expect(
      validateHostHeader(
        new Request('http://runtime.test', {
          headers: { host: 'LOCALHOST:3000' }
        }),
        ['localhost:*']
      )
    ).toBeUndefined()

    expect(
      validateHostHeader(
        new Request('http://runtime.test', {
          headers: { host: '[::1]:3000' }
        }),
        ['[::1]:*']
      )
    ).toBeUndefined()

    expect(
      validateHostHeader(
        new Request('http://runtime.test', {
          headers: { host: '[::1:3000' }
        }),
        ['[::1:3000']
      )
    ).toBeUndefined()
  })

  it('rejects missing, disallowed and implicit any-port host headers', () => {
    const missing = {
      headers: {
        get(name: string) {
          return name === 'host' ? null : null
        }
      }
    } as unknown as Request

    expect(validateHostHeader(missing, ['localhost'])).toBe(
      'Missing Host header.'
    )
    expect(
      validateHostHeader(
        new Request('http://runtime.test', {
          headers: { host: 'evil.example' }
        }),
        ['localhost']
      )
    ).toBe('Host "evil.example" is not allowed.')

    expect(
      validateHostHeader(
        new Request('http://runtime.test', {
          headers: { host: 'LOCALHOST:3000' }
        }),
        ['localhost']
      )
    ).toBe('Host "LOCALHOST:3000" is not allowed.')
  })
})

describe('validateOriginHeader and corsHeaders', () => {
  it('validates origins and returns empty cors headers when Origin is missing', () => {
    const noOrigin = new Request('http://runtime.test')

    expect(validateOriginHeader(noOrigin, ['https://client.example'])).toBe(
      undefined
    )
    expect(corsHeaders(noOrigin, corsOptions()).entries().next().done).toBe(
      true
    )
  })

  it('accepts allowed origins and includes credentials only when enabled', () => {
    const request = new Request('http://runtime.test', {
      headers: { origin: 'https://client.example' }
    })
    const headers = corsHeaders(request, corsOptions())
    const publicHeaders = corsHeaders(request, {
      ...corsOptions(),
      allowCredentials: false
    })

    expect(
      validateOriginHeader(request, ['https://client.example'])
    ).toBeUndefined()
    expect(headers.get('Access-Control-Allow-Origin')).toBe(
      'https://client.example'
    )
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(publicHeaders.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('rejects disallowed origins', () => {
    const request = new Request('http://runtime.test', {
      headers: { origin: 'https://evil.example' }
    })

    expect(validateOriginHeader(request, ['https://client.example'])).toBe(
      'Origin "https://evil.example" is not allowed.'
    )
  })
})

function corsOptions() {
  return {
    allowCredentials: true,
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAgeSeconds: 60
  }
}
