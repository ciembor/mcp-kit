import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  correlationHeadersMock,
  setCorrelationHeaderMock,
  withCorrelationIdMock,
  controlEndpointResponseMock,
  createStreamableHttpHandlerMock,
  requestUrlFromNodeRequestMock,
  normalizeStreamableHttpOptionsMock
} = vi.hoisted(() => ({
  correlationHeadersMock: vi.fn(),
  setCorrelationHeaderMock: vi.fn(),
  withCorrelationIdMock: vi.fn(),
  controlEndpointResponseMock: vi.fn(),
  createStreamableHttpHandlerMock: vi.fn(),
  requestUrlFromNodeRequestMock: vi.fn(),
  normalizeStreamableHttpOptionsMock: vi.fn()
}))

vi.mock('./correlation-id.js', () => ({
  correlationHeaders: correlationHeadersMock,
  setCorrelationHeader: setCorrelationHeaderMock,
  withCorrelationId: withCorrelationIdMock
}))

vi.mock('./http-control-endpoints.js', () => ({
  controlEndpointResponse: controlEndpointResponseMock,
  protectedResourceMetadataPath: '/.well-known/oauth-protected-resource/mcp'
}))

vi.mock('./http-handler.js', () => ({
  createStreamableHttpHandler: createStreamableHttpHandlerMock
}))

vi.mock('./proxy-resolution.js', () => ({
  requestUrlFromNodeRequest: requestUrlFromNodeRequestMock
}))

vi.mock('./http-security.js', () => ({
  normalizeStreamableHttpOptions: normalizeStreamableHttpOptionsMock
}))

import { createNodeHttpRuntime, protectedResourceMetadataPath } from './http-node-runtime.js'

beforeEach(() => {
  correlationHeadersMock.mockReset()
  setCorrelationHeaderMock.mockReset()
  withCorrelationIdMock.mockReset()
  controlEndpointResponseMock.mockReset()
  createStreamableHttpHandlerMock.mockReset()
  requestUrlFromNodeRequestMock.mockReset()
  normalizeStreamableHttpOptionsMock.mockReset()

  correlationHeadersMock.mockReturnValue('corr-123')
  withCorrelationIdMock.mockImplementation((response) => response)
  controlEndpointResponseMock.mockReturnValue(undefined)
  requestUrlFromNodeRequestMock.mockReturnValue('http://runtime.test/mcp')
  normalizeStreamableHttpOptionsMock.mockImplementation((options) => ({
    host: '127.0.0.1',
    path: '/mcp',
    port: 0,
    requestTimeoutMs: 5_000,
    maxBodyBytes: 16,
    trustedProxies: [],
    sessionStore: undefined,
    ...options
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createNodeHttpRuntime branches', () => {
  it('exports the protected resource metadata path', () => {
    expect(protectedResourceMetadataPath).toBe(
      '/.well-known/oauth-protected-resource/mcp'
    )
  })

  it('builds a default GET request and normalizes mixed node headers', async () => {
    const handler = vi.fn(async ({ request, parsedBody }) => ({
      response: new Response(null, { status: 204 }),
      close: vi.fn(() => Promise.resolve()),
      seen: { request, parsedBody }
    }))
    createStreamableHttpHandlerMock.mockReturnValue(handler)

    const runtime = createNodeHttpRuntime(vi.fn(), {
      trustedProxies: ['127.0.0.1']
    })
    const req = createRequest({
      method: undefined,
      headers: {
        host: 'runtime.test',
        'content-length': ['12'],
        'x-list': ['a', 'b'],
        'x-skip': undefined
      }
    })
    const res = createResponse()

    await runtime.handle(req, res)

    expect(requestUrlFromNodeRequestMock).toHaveBeenCalledWith(req, ['127.0.0.1'])
    expect(setCorrelationHeaderMock).toHaveBeenCalledWith(
      expect.any(Headers),
      'corr-123'
    )
    expect(handler).toHaveBeenCalledWith({
      request: expect.any(Request),
      parsedBody: undefined
    })
    const request = handler.mock.calls[0]?.[0].request as Request
    expect(request.method).toBe('GET')
    expect(request.headers.get('x-list')).toBe('a, b')
    expect(request.headers.get('x-skip')).toBeNull()
    expect(res.statusCode).toBe(204)
    expect(res.end).toHaveBeenCalled()
  })

  it('returns a 413 error when streamed body chunks exceed the limit', async () => {
    const handler = vi.fn()
    createStreamableHttpHandlerMock.mockReturnValue(handler)

    const runtime = createNodeHttpRuntime(vi.fn(), {
      maxBodyBytes: 4
    })
    const req = createRequest({
      method: 'POST',
      headers: {},
      chunks: ['hello']
    })
    const res = createResponse()

    await runtime.handle(req, res)

    expect(handler).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(413, {
      'content-type': 'application/json; charset=utf-8',
      'x-correlation-id': 'corr-123'
    })
    expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        code: -32000,
        message: 'Request body exceeds 4 bytes.'
      }
    })
  })

  it('serializes non-Error runtime failures without rewriting sent headers', async () => {
    createStreamableHttpHandlerMock.mockReturnValue(
      vi.fn(async () => {
        throw 'boom'
      })
    )

    const runtime = createNodeHttpRuntime(vi.fn(), {})
    const req = createRequest({
      method: 'POST',
      headers: {},
      chunks: ['{}']
    })
    const res = createResponse({ headersSent: true })

    await runtime.handle(req, res)

    expect(res.writeHead).not.toHaveBeenCalled()
    expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        code: -32603,
        message: 'boom'
      }
    })
  })
})

function createRequest({
  method,
  headers,
  chunks = []
}: {
  method?: string
  headers: Record<string, string | string[] | undefined>
  chunks?: string[]
}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk)
      }
    }
  }
}

function createResponse(overrides: Record<string, unknown> = {}) {
  return {
    headersSent: false,
    statusCode: 200,
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    ...overrides
  }
}
