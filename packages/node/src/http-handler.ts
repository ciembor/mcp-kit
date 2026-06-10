import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import type {
  McpAppFactory,
  StreamableHttpCorsOptions,
  StreamableHttpExchange,
  StreamableHttpHandler,
  StreamableHttpOptions,
  StreamableHttpRequest
} from './http-contracts.js'
import {
  corsHeaders,
  normalizeStreamableHttpOptions,
  validateHostHeader,
  validateOriginHeader
} from './http-security.js'
import { createStderrLogger } from './stderr-logger.js'

export function createStreamableHttpHandler<Services>(
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): StreamableHttpHandler {
  const normalized = normalizeStreamableHttpOptions(options)
  let activeRequests = 0

  return async ({ request, parsedBody }: StreamableHttpRequest) => {
    const url = new URL(request.url)
    if (url.pathname !== normalized.path) {
      return staticExchange(new Response(null, { status: 404 }))
    }

    const hostError = validateHostHeader(request, normalized.allowedHosts)
    if (hostError !== undefined) {
      return staticExchange(jsonError(403, hostError))
    }

    const originError = validateOriginHeader(request, normalized.allowedOrigins)
    if (originError !== undefined) {
      return staticExchange(jsonError(403, originError))
    }

    if (request.method === 'OPTIONS') {
      if (normalized.cors === false) {
        return staticExchange(jsonError(403, 'CORS is not enabled.'))
      }
      return staticExchange(
        new Response(null, {
          status: 204,
          headers: corsHeaders(request, normalized.cors)
        })
      )
    }

    if (activeRequests >= normalized.maxConcurrency) {
      return staticExchange(
        jsonError(503, 'Too many concurrent MCP HTTP requests.')
      )
    }

    activeRequests += 1
    const app = createApp()
    app.setLogger(createStderrLogger())
    const transport = new WebStandardStreamableHTTPServerTransport()

    try {
      await app.connect(transport)
      const response = await transport.handleRequest(
        request,
        parsedBody === undefined ? undefined : { parsedBody }
      )
      return {
        response: withCorsHeaders(response, request, normalized.cors),
        close() {
          activeRequests -= 1
          return Promise.all([transport.close(), app.close()]).then(() => undefined)
        }
      } satisfies StreamableHttpExchange
    } catch (error) {
      activeRequests -= 1
      await transport.close().catch(() => undefined)
      await app.close().catch(() => undefined)
      throw error
    }
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null
    }),
    {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  )
}

function staticExchange(response: Response): StreamableHttpExchange {
  return {
    response,
    close: () => Promise.resolve()
  }
}

function withCorsHeaders(
  response: Response,
  request: Request,
  cors: false | Required<StreamableHttpCorsOptions>
): Response {
  if (cors === false) return response
  const headers = new Headers(response.headers)
  for (const [key, value] of corsHeaders(request, cors).entries()) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
