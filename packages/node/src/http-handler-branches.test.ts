import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transportCtorMock,
  authenticateRequestMock,
  closeManagedResourcesMock,
  createConfiguredAppMock,
  createResponseExchangeMock,
  createTransportOptionsMock,
  existingSessionMock,
  existingSessionExchangeMock,
  newStatefulSessionExchangeMock,
  corsHeadersMock,
  normalizeStreamableHttpOptionsMock,
  validateHostHeaderMock,
  validateOriginHeaderMock
} = vi.hoisted(() => ({
  transportCtorMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  closeManagedResourcesMock: vi.fn(),
  createConfiguredAppMock: vi.fn(),
  createResponseExchangeMock: vi.fn(),
  createTransportOptionsMock: vi.fn(),
  existingSessionMock: vi.fn(),
  existingSessionExchangeMock: vi.fn(),
  newStatefulSessionExchangeMock: vi.fn(),
  corsHeadersMock: vi.fn(),
  normalizeStreamableHttpOptionsMock: vi.fn(),
  validateHostHeaderMock: vi.fn(),
  validateOriginHeaderMock: vi.fn()
}))

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest
    close

    constructor(options: unknown) {
      const instance = transportCtorMock(options)
      this.handleRequest = instance.handleRequest
      this.close = instance.close
    }
  }
}))

vi.mock('./http-auth.js', () => ({
  authenticateRequest: authenticateRequestMock
}))

vi.mock('./http-handler-stateful.js', () => ({
  closeManagedResources: closeManagedResourcesMock,
  createConfiguredApp: createConfiguredAppMock,
  createResponseExchange: createResponseExchangeMock,
  createTransportOptions: createTransportOptionsMock,
  existingSession: existingSessionMock,
  existingSessionExchange: existingSessionExchangeMock,
  newStatefulSessionExchange: newStatefulSessionExchangeMock
}))

vi.mock('./http-security.js', () => ({
  corsHeaders: corsHeadersMock,
  normalizeStreamableHttpOptions: normalizeStreamableHttpOptionsMock,
  validateHostHeader: validateHostHeaderMock,
  validateOriginHeader: validateOriginHeaderMock
}))

import { createStreamableHttpHandler } from './http-handler.js'

beforeEach(() => {
  transportCtorMock.mockReset()
  authenticateRequestMock.mockReset()
  closeManagedResourcesMock.mockReset()
  createConfiguredAppMock.mockReset()
  createResponseExchangeMock.mockReset()
  createTransportOptionsMock.mockReset()
  existingSessionMock.mockReset()
  existingSessionExchangeMock.mockReset()
  newStatefulSessionExchangeMock.mockReset()
  corsHeadersMock.mockReset()
  normalizeStreamableHttpOptionsMock.mockReset()
  validateHostHeaderMock.mockReset()
  validateOriginHeaderMock.mockReset()

  authenticateRequestMock.mockResolvedValue({})
  closeManagedResourcesMock.mockResolvedValue(undefined)
  createTransportOptionsMock.mockReturnValue({ retryInterval: 500 })
  createResponseExchangeMock.mockImplementation(
    (response, _request, _cors, close) => ({
      response,
      close
    })
  )
  validateHostHeaderMock.mockReturnValue(undefined)
  validateOriginHeaderMock.mockReturnValue(undefined)
  corsHeadersMock.mockReturnValue(new Headers({ 'x-cors': '1' }))
  normalizeStreamableHttpOptionsMock.mockImplementation((options) => ({
    path: '/mcp',
    sessionMode: 'stateless',
    maxConcurrency: 2,
    cors: false,
    allowedHosts: ['runtime.test'],
    allowedOrigins: ['https://client.example'],
    auth: undefined,
    sessionStore: undefined,
    ...options
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createStreamableHttpHandler branches', () => {
  it('handles stateless requests without parsed bodies or auth info', async () => {
    const transport = {
      handleRequest: vi.fn(async () => new Response('ok')),
      close: vi.fn(async () => undefined)
    }
    const app = {
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    }
    transportCtorMock.mockImplementation(() => transport)
    createConfiguredAppMock.mockReturnValue(app)

    const handler = createStreamableHttpHandler(vi.fn(), {})
    const exchange = await handler({
      request: new Request('http://runtime.test/mcp', { method: 'POST' }),
      parsedBody: undefined
    })

    expect(createTransportOptionsMock).toHaveBeenCalled()
    expect(transport.handleRequest).toHaveBeenCalledWith(
      expect.any(Request),
      {}
    )
    await exchange.close()
    expect(transport.close).toHaveBeenCalledTimes(1)
    expect(app.close).toHaveBeenCalledTimes(1)
  })

  it('closes managed resources when stateless transport handling fails', async () => {
    const error = new Error('transport failed')
    const transport = {
      handleRequest: vi.fn(async () => {
        throw error
      }),
      close: vi.fn(async () => undefined)
    }
    const app = {
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    }
    transportCtorMock.mockImplementation(() => transport)
    createConfiguredAppMock.mockReturnValue(app)

    const handler = createStreamableHttpHandler(vi.fn(), {})

    await expect(
      handler({
        request: new Request('http://runtime.test/mcp', { method: 'POST' }),
        parsedBody: { hello: 'world' }
      })
    ).rejects.toThrow(error)
    expect(closeManagedResourcesMock).toHaveBeenCalledWith(app, transport)
  })

  it('rejects path misses and OPTIONS without cors', async () => {
    const handler = createStreamableHttpHandler(vi.fn(), {})

    const notFound = await handler({
      request: new Request('http://runtime.test/other', { method: 'POST' }),
      parsedBody: undefined
    })
    const preflight = await handler({
      request: new Request('http://runtime.test/mcp', { method: 'OPTIONS' }),
      parsedBody: undefined
    })

    expect(notFound.response.status).toBe(404)
    expect(preflight.response.status).toBe(403)
    await expect(preflight.response.json()).resolves.toMatchObject({
      error: { message: 'CORS is not enabled.' }
    })
  })

  it('rejects stateful requests without a session store', async () => {
    normalizeStreamableHttpOptionsMock.mockReturnValueOnce({
      path: '/mcp',
      sessionMode: 'stateful',
      sessionStore: undefined,
      maxConcurrency: 2,
      cors: false,
      allowedHosts: ['runtime.test'],
      allowedOrigins: [],
      auth: undefined
    })
    const handler = createStreamableHttpHandler(vi.fn(), {})

    await expect(
      handler({
        request: new Request('http://runtime.test/mcp', { method: 'POST' }),
        parsedBody: undefined
      })
    ).rejects.toThrow('Stateful Streamable HTTP requires a SessionStore.')
  })

  it('returns 404 for unknown stateful sessions and auth rejections for existing ones', async () => {
    const sessionStore = { get: vi.fn() }
    normalizeStreamableHttpOptionsMock.mockReturnValueOnce({
      path: '/mcp',
      sessionMode: 'stateful',
      sessionStore,
      maxConcurrency: 2,
      cors: false,
      allowedHosts: ['runtime.test'],
      allowedOrigins: [],
      auth: { verifyBearerToken: vi.fn() }
    })
    existingSessionMock.mockResolvedValueOnce('missing')
    const missingHandler = createStreamableHttpHandler(vi.fn(), {})

    const missing = await missingHandler({
      request: new Request('http://runtime.test/mcp', { method: 'POST' }),
      parsedBody: undefined
    })

    expect(missing.response.status).toBe(404)
    await expect(missing.response.json()).resolves.toMatchObject({
      error: { message: 'Unknown MCP session.' }
    })

    normalizeStreamableHttpOptionsMock.mockReturnValueOnce({
      path: '/mcp',
      sessionMode: 'stateful',
      sessionStore,
      maxConcurrency: 2,
      cors: false,
      allowedHosts: ['runtime.test'],
      allowedOrigins: [],
      auth: { verifyBearerToken: vi.fn() }
    })
    existingSessionMock.mockResolvedValueOnce({ id: 'session-1' })
    authenticateRequestMock.mockResolvedValueOnce({
      rejection: new Response('nope', { status: 401 })
    })
    const rejectedHandler = createStreamableHttpHandler(vi.fn(), {})

    const rejected = await rejectedHandler({
      request: new Request('http://runtime.test/mcp', { method: 'POST' }),
      parsedBody: undefined
    })

    expect(rejected.response.status).toBe(401)
  })
})
