import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockTransportInstance = {
  sessionId: string | undefined
  handleRequest: ReturnType<
    typeof vi.fn<(request: Request, init?: unknown) => Promise<Response>>
  >
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
}

type MockApp = {
  setLogger: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn<(transport: unknown) => Promise<void>>>
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
}

const {
  randomUUIDMock,
  transportCtorMock,
  sameAuthIdentityMock,
  corsHeadersMock,
  createStderrLoggerMock
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  transportCtorMock: vi.fn<(options: unknown) => MockTransportInstance>(),
  sameAuthIdentityMock: vi.fn(),
  corsHeadersMock: vi.fn(),
  createStderrLoggerMock: vi.fn()
}))

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock
}))

vi.mock(
  '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js',
  () => ({
    WebStandardStreamableHTTPServerTransport: class {
      sessionId
      handleRequest
      close
      options

      constructor(options: unknown) {
        const instance = transportCtorMock(options)
        this.options = options
        this.sessionId = instance.sessionId
        this.handleRequest = instance.handleRequest
        this.close = instance.close
      }
    }
  })
)

vi.mock('./http-auth.js', () => ({
  sameAuthIdentity: sameAuthIdentityMock
}))

vi.mock('./http-security.js', () => ({
  corsHeaders: corsHeadersMock
}))

vi.mock('./stderr-logger.js', () => ({
  createStderrLogger: createStderrLoggerMock
}))

import {
  closeManagedResources,
  createConfiguredApp,
  createResponseExchange,
  createTransportOptions,
  existingSession,
  existingSessionExchange,
  newStatefulSessionExchange
} from './http-handler-stateful.js'

beforeEach(() => {
  randomUUIDMock.mockReset()
  transportCtorMock.mockReset()
  sameAuthIdentityMock.mockReset()
  corsHeadersMock.mockReset()
  createStderrLoggerMock.mockReset()

  randomUUIDMock.mockReturnValue('session-uuid')
  sameAuthIdentityMock.mockReturnValue(true)
  corsHeadersMock.mockReturnValue(
    new Headers({ 'access-control-allow-origin': 'https://client.example' })
  )
  createStderrLoggerMock.mockReturnValue({ info: vi.fn() })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stateful handler branches', () => {
  it('returns undefined or missing for existing sessions lookup', async () => {
    const sessionStore = {
      get: vi.fn()
    }

    await expect(
      existingSession(
        new Request('http://runtime.test/mcp'),
        sessionStore as never
      )
    ).resolves.toBeUndefined()

    sessionStore.get = vi.fn(() => Promise.resolve(undefined))
    await expect(
      existingSession(
        new Request('http://runtime.test/mcp', {
          headers: { 'mcp-session-id': 'missing-session' }
        }),
        sessionStore as never
      )
    ).resolves.toBe('missing')
  })

  it('rejects auth mismatches and reuses close promises for response exchanges', async () => {
    sameAuthIdentityMock.mockReturnValueOnce(false)

    const rejected = await existingSessionExchange({
      session: {
        id: 'session-1',
        auth: { source: 'oauth', scopes: [], subject: 'alice' },
        handleRequest: vi.fn(),
        close: vi.fn()
      },
      auth: { source: 'oauth', scopes: [], subject: 'bob' },
      request: new Request('http://runtime.test/mcp'),
      parsedBody: undefined,
      cors: false
    })

    expect(rejected.response.status).toBe(403)
    await expect(rejected.response.json()).resolves.toMatchObject({
      error: {
        message: 'Session subject or tenant does not match this request.'
      }
    })

    const close = vi.fn(() => Promise.resolve())
    const exchange = createResponseExchange(
      new Response('ok'),
      new Request('http://runtime.test/mcp'),
      false,
      close
    )

    const first = exchange.close()
    const second = exchange.close()
    expect(first).toBe(second)
    await first
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('adds cors headers to responses when enabled', () => {
    const exchange = createResponseExchange(
      new Response('ok', {
        status: 202,
        headers: { 'content-type': 'text/plain' }
      }),
      new Request('http://runtime.test/mcp', {
        headers: { origin: 'https://client.example' }
      }),
      {
        allowCredentials: true,
        allowedHeaders: ['Authorization'],
        maxAgeSeconds: 60
      }
    )

    expect(exchange.response.status).toBe(202)
    expect(exchange.response.headers.get('content-type')).toBe('text/plain')
    expect(exchange.response.headers.get('access-control-allow-origin')).toBe(
      'https://client.example'
    )
  })

  it('swallows close failures for managed resources and configures loggers', async () => {
    const app: MockApp = {
      setLogger: vi.fn(),
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.reject(new Error('app close failed')))
    }
    const transport = {
      close: vi.fn(() => Promise.reject(new Error('transport close failed')))
    }

    await expect(
      closeManagedResources(app as never, transport as never)
    ).resolves.toBeUndefined()

    const configured = createConfiguredApp(() => app as never)
    expect(configured).toBe(app)
    expect(app.setLogger).toHaveBeenCalledWith(
      createStderrLoggerMock.mock.results[0]?.value
    )
  })

  it('persists authorization details into stateful session auth info', async () => {
    const sessionStore = {
      get: vi.fn(() =>
        Promise.resolve({
          close: vi.fn(() => Promise.resolve())
        })
      ),
      set: vi.fn<(sessionId: string, session: unknown) => Promise<void>>(() =>
        Promise.resolve()
      ),
      delete: vi.fn(() => Promise.resolve())
    }
    const app: MockApp = {
      setLogger: vi.fn(),
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    }
    const transport: MockTransportInstance = {
      sessionId: 'session-authz',
      handleRequest: vi.fn(() => Promise.resolve(new Response('ok'))),
      close: vi.fn(() => Promise.resolve())
    }
    transportCtorMock.mockReturnValueOnce(transport)

    await newStatefulSessionExchange({
      createApp: () => app as never,
      options: {
        sessionStore,
        cors: false
      } as never,
      request: new Request('http://runtime.test/mcp'),
      parsedBody: undefined,
      auth: {
        source: 'oauth',
        scopes: ['tools:read'],
        authorization: {
          availableScopes: ['tools:read'],
          consent: {
            clientId: 'client-1',
            scopes: ['tools:read'],
            subject: 'alice'
          }
        }
      },
      sessionStore: sessionStore as never
    })

    expect(sessionStore.set).toHaveBeenCalledOnce()
    const setCall = sessionStore.set.mock.calls[0]
    expect(setCall).toBeDefined()
    if (setCall) {
      const [, session] = setCall
      expect(session).toMatchObject({
        auth: {
          authorization: {
            availableScopes: ['tools:read'],
            consent: {
              clientId: 'client-1',
              scopes: ['tools:read'],
              subject: 'alice'
            }
          }
        }
      })
    }
  })

  it('builds transport options only from configured resumability settings', () => {
    expect(
      createTransportOptions({
        eventStore: undefined,
        retryIntervalMs: undefined
      } as never)
    ).toEqual({})

    const eventStore = { replayEventsAfter: vi.fn(), storeEvent: vi.fn() }
    expect(
      createTransportOptions({
        eventStore,
        retryIntervalMs: 2_500
      } as never)
    ).toEqual({
      eventStore,
      retryInterval: 2_500
    })
  })

  it('cleans up a newly-created session when handling or connect fails', async () => {
    const deleteMock = vi.fn(() => Promise.resolve())
    const sessionStore = {
      get: vi.fn(() =>
        Promise.resolve({
          close: vi.fn(() => Promise.resolve())
        })
      ),
      set: vi.fn(() => Promise.resolve()),
      delete: deleteMock
    }
    const app: MockApp = {
      setLogger: vi.fn(),
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    }
    const transport: MockTransportInstance = {
      sessionId: 'session-1',
      handleRequest: vi.fn(() => Promise.reject(new Error('request failed'))),
      close: vi.fn(() => Promise.resolve())
    }
    transportCtorMock.mockReturnValueOnce(transport)

    await expect(
      newStatefulSessionExchange({
        createApp: () => app as never,
        options: {
          sessionStore,
          cors: false
        } as never,
        request: new Request('http://runtime.test/mcp'),
        parsedBody: undefined,
        auth: undefined,
        sessionStore: sessionStore as never
      })
    ).rejects.toThrow('request failed')

    expect(deleteMock).toHaveBeenCalledWith('session-1')

    const failingApp: MockApp = {
      setLogger: vi.fn(),
      connect: vi.fn(() => Promise.reject(new Error('connect failed'))),
      close: vi.fn(() => Promise.resolve())
    }
    const connectTransport: MockTransportInstance = {
      sessionId: undefined,
      handleRequest: vi.fn(),
      close: vi.fn(() => Promise.resolve())
    }
    transportCtorMock.mockReturnValueOnce(connectTransport)

    await expect(
      newStatefulSessionExchange({
        createApp: () => failingApp as never,
        options: {
          sessionStore,
          cors: false
        } as never,
        request: new Request('http://runtime.test/mcp'),
        parsedBody: undefined,
        auth: undefined,
        sessionStore: sessionStore as never
      })
    ).rejects.toThrow('connect failed')
    expect(connectTransport.close).toHaveBeenCalledTimes(1)
    expect(failingApp.close).toHaveBeenCalledTimes(1)
  })

  it('throws without a session store and closes sessions without ids instead of persisting them', async () => {
    await expect(
      newStatefulSessionExchange({
        createApp: vi.fn(),
        options: {
          sessionStore: undefined,
          cors: false
        } as never,
        request: new Request('http://runtime.test/mcp'),
        parsedBody: undefined,
        auth: undefined,
        sessionStore: undefined as never
      })
    ).rejects.toThrow('Stateful Streamable HTTP requires a SessionStore.')

    const sessionStore = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve())
    }
    const app: MockApp = {
      setLogger: vi.fn(),
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    }
    const transport: MockTransportInstance = {
      sessionId: undefined,
      handleRequest: vi.fn(() => Promise.resolve(new Response('ok'))),
      close: vi.fn(() => Promise.resolve())
    }
    transportCtorMock.mockReturnValueOnce(transport)

    const exchange = await newStatefulSessionExchange({
      createApp: () => app as never,
      options: {
        sessionStore,
        cors: false
      } as never,
      request: new Request('http://runtime.test/mcp'),
      parsedBody: undefined,
      auth: {
        source: 'oauth',
        scopes: ['users:read'],
        subject: 'alice',
        tenantId: 'tenant-a',
        expiresAt: Date.parse('2026-06-12T00:00:00.000Z'),
        resource: new URL('https://resource-1.example')
      },
      sessionStore: sessionStore as never
    })

    expect(exchange.response.status).toBe(200)
    expect(sessionStore.set).not.toHaveBeenCalled()
    expect(app.close).toHaveBeenCalledTimes(1)
    expect(transport.close).toHaveBeenCalledTimes(1)
    expect(transport.handleRequest).toHaveBeenCalledWith(expect.any(Request), {
      authInfo: {
        token: '',
        clientId: 'mcp-kit',
        scopes: ['users:read'],
        expiresAt: Date.parse('2026-06-12T00:00:00.000Z'),
        resource: new URL('https://resource-1.example'),
        extra: {
          subject: 'alice',
          tenantId: 'tenant-a'
        }
      }
    })
  })

  it('returns an empty session id before the transport assigns one and ignores missing close targets', async () => {
    const sessionStore = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve())
    }
    const app: MockApp = {
      setLogger: vi.fn(),
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve())
    }
    const transport: MockTransportInstance = {
      sessionId: undefined,
      handleRequest: vi.fn(() => Promise.reject(new Error('request failed'))),
      close: vi.fn(() => Promise.resolve())
    }
    transportCtorMock.mockReturnValueOnce(transport)

    await expect(
      newStatefulSessionExchange({
        createApp: () => app as never,
        options: {
          sessionStore,
          cors: false
        } as never,
        request: new Request('http://runtime.test/mcp'),
        parsedBody: undefined,
        auth: {
          source: 'oauth',
          token: 'service-token',
          clientId: 'service-client',
          scopes: ['service:read'],
          extra: { role: 'robot' }
        },
        sessionStore: sessionStore as never
      })
    ).rejects.toThrow('request failed')

    const ctorOptions = transportCtorMock.mock.calls.at(-1)?.[0] as {
      onsessionclosed: (sessionId: string) => Promise<void>
    }
    await expect(
      ctorOptions.onsessionclosed('unknown-session')
    ).resolves.toBeUndefined()
    expect(sessionStore.delete).not.toHaveBeenCalled()
    expect(transport.handleRequest).toHaveBeenCalledWith(expect.any(Request), {
      authInfo: {
        token: '',
        clientId: 'service-client',
        scopes: ['service:read'],
        extra: { role: 'robot' }
      }
    })
  })
})
