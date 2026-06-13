import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'

type MockExchange = {
  response: Response
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
}

type HandlerArgs = {
  request: Request
  parsedBody?: unknown
}

type MockResponse = {
  headersSent: boolean
  statusCode: number
  setHeader: ReturnType<typeof vi.fn>
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

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
  withCorrelationIdMock: vi.fn<(response: Response) => Response>(),
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

import {
  createNodeHttpRuntime,
  protectedResourceMetadataPath
} from './http-node-runtime.js'

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
  normalizeStreamableHttpOptionsMock.mockImplementation(
    (options: Record<string, unknown>) => ({
      host: '127.0.0.1',
      path: '/mcp',
      port: 0,
      requestTimeoutMs: 5_000,
      maxBodyBytes: 16,
      trustedProxies: [],
      sessionStore: undefined,
      ...options
    })
  )
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
    const handler = vi.fn<(args: HandlerArgs) => Promise<MockExchange>>(
      ({ request, parsedBody }) =>
        Promise.resolve({
          response: new Response(null, { status: 204 }),
          close: vi.fn(() => Promise.resolve()),
          seen: { request, parsedBody }
        } as MockExchange)
    )
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

    await runtime.handle(req, res as never)

    expect(requestUrlFromNodeRequestMock).toHaveBeenCalledWith(req, [
      '127.0.0.1'
    ])
    expect(setCorrelationHeaderMock).toHaveBeenCalledWith(
      expect.any(Headers),
      'corr-123'
    )
    expect(handler).toHaveBeenCalledTimes(1)
    const handlerArgs = handler.mock.calls[0]?.[0]
    expect(handlerArgs?.parsedBody).toBeUndefined()
    expect(handlerArgs?.request).toBeInstanceOf(Request)
    const request = handlerArgs!.request
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

    await runtime.handle(req, res as never)

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

  it('returns a JSON-RPC parse error for invalid JSON bodies', async () => {
    const handler = vi.fn()
    createStreamableHttpHandlerMock.mockReturnValue(handler)

    const runtime = createNodeHttpRuntime(vi.fn(), {})
    const req = createRequest({
      method: 'POST',
      headers: {},
      chunks: ['{']
    })
    const res = createResponse()

    await runtime.handle(req, res as never)

    expect(handler).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      'content-type': 'application/json; charset=utf-8',
      'x-correlation-id': 'corr-123'
    })
    expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        code: -32700,
        message: 'Parse error.'
      }
    })
  })

  it('serializes unexpected runtime failures without leaking details or rewriting sent headers', async () => {
    createStreamableHttpHandlerMock.mockReturnValue(
      vi.fn(() => rejectWith('boom'))
    )

    const runtime = createNodeHttpRuntime(vi.fn(), {})
    const req = createRequest({
      method: 'POST',
      headers: {},
      chunks: ['{}']
    })
    const res = createResponse({ headersSent: true })

    await runtime.handle(req, res as never)

    expect(res.writeHead).not.toHaveBeenCalled()
    expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        code: -32603,
        message: 'Internal server error. Correlation id: corr-123'
      }
    })
  })
})

function createRequest({
  method,
  headers,
  chunks = []
}: {
  method: string | undefined
  headers: Record<string, string | string[] | undefined>
  chunks?: string[]
}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield await Promise.resolve(Buffer.from(chunk))
      }
    }
  } as IncomingMessage
}

function createResponse(overrides: Partial<MockResponse> = {}): MockResponse {
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

function rejectWith<T>(reason: unknown): Promise<T> {
  return {
    then: (_resolve, reject) => {
      reject?.(reason)
    }
  } as Promise<T>
}
