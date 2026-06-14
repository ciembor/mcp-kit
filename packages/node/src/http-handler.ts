import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import type {
  McpAppFactory,
  NormalizedStreamableHttpOptions,
  StreamableHttpCorsOptions,
  StreamableHttpExchange,
  StreamableHttpHandler,
  StreamableHttpOptions,
  StreamableHttpRequest
} from './http-contracts.js'
import { authenticateRequest } from './http-auth.js'
import { createHttpObservability } from './http-observability.js'
import {
  closeManagedResources,
  createConfiguredApp,
  createResponseExchange,
  createTransportOptions,
  existingSession,
  existingSessionExchange,
  newStatefulSessionExchange
} from './http-handler-stateful.js'
import { assertProductionStoreSafety } from './http-production-store-safety.js'
import {
  corsHeaders,
  normalizeStreamableHttpOptions,
  validateHostHeader,
  validateOriginHeader
} from './http-security.js'

export function createStreamableHttpHandler<Services>(
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): StreamableHttpHandler {
  const normalized = normalizeStreamableHttpOptions(options)
  let productionStoresValidated = false
  let activeRequests = 0
  const observability = createHttpObservability(normalized.observability)

  const createValidatedApp = () => {
    if (!productionStoresValidated) {
      assertProductionStoreSafety(createApp, normalized)
      productionStoresValidated = true
    }
    return createConfiguredApp(createApp)
  }

  return async ({ request, parsedBody }: StreamableHttpRequest) => {
    const requestObservation = observability.startRequest(request, normalized)
    const rejected = rejectRequest(request, normalized)
    if (rejected !== undefined) {
      await requestObservation.end({ response: rejected.response })
      return rejected
    }

    if (request.method === 'OPTIONS') {
      const exchange = preflightExchange(request, normalized.cors)
      await requestObservation.end({ response: exchange.response })
      return exchange
    }

    if (activeRequests >= normalized.maxConcurrency) {
      const exchange = staticExchange(
        jsonError(503, 'Too many concurrent MCP HTTP requests.')
      )
      await requestObservation.end({ response: exchange.response })
      return exchange
    }

    activeRequests += 1
    try {
      if (normalized.sessionMode === 'stateful') {
        const exchange = await handleStatefulRequest(
          createValidatedApp,
          normalized,
          request,
          parsedBody,
          observability
        )
        await requestObservation.end({ response: exchange.response })
        return exchange
      }
      const exchange = await handleStatelessRequest(
        createValidatedApp,
        normalized,
        request,
        parsedBody
      )
      await requestObservation.end({ response: exchange.response })
      return exchange
    } catch (error) {
      await requestObservation.end({ error })
      throw error
    } finally {
      activeRequests -= 1
    }
  }
}

async function handleStatelessRequest<Services>(
  createApp: McpAppFactory<Services>,
  options: NormalizedStreamableHttpOptions,
  request: Request,
  parsedBody: unknown
): Promise<StreamableHttpExchange> {
  const auth = await authenticateRequest(request, options.auth)
  if (auth.rejection !== undefined) {
    return staticExchange(auth.rejection)
  }

  const app = createApp()
  const transport = new WebStandardStreamableHTTPServerTransport(
    createTransportOptions(options)
  )

  try {
    await app.connect(transport)
    const response = await transport.handleRequest(request, {
      ...(parsedBody === undefined ? {} : { parsedBody }),
      ...(auth.authInfo === undefined ? {} : { authInfo: auth.authInfo })
    })
    return createResponseExchange(response, request, options.cors, async () => {
      await transport.close()
      await app.close()
    })
  } catch (error) {
    await closeManagedResources(app, transport)
    throw error
  }
}

async function handleStatefulRequest<Services>(
  createApp: McpAppFactory<Services>,
  options: NormalizedStreamableHttpOptions,
  request: Request,
  parsedBody: unknown,
  observability: ReturnType<typeof createHttpObservability>
): Promise<StreamableHttpExchange> {
  const sessionStore = options.sessionStore
  if (sessionStore === undefined) {
    throw new Error('Stateful Streamable HTTP requires a SessionStore.')
  }

  const session = await existingSession(request, sessionStore)
  if (session === 'missing') {
    return staticExchange(jsonError(404, 'Unknown MCP session.'))
  }

  const auth = await authenticateRequest(request, options.auth)
  if (auth.rejection !== undefined) {
    return staticExchange(auth.rejection)
  }

  if (session !== undefined) {
    return await existingSessionExchange({
      session,
      auth: auth.auth,
      request,
      parsedBody,
      cors: options.cors
    })
  }

  return await newStatefulSessionExchange({
    createValidatedApp: createApp,
    options,
    request,
    parsedBody,
    auth: auth.auth,
    sessionStore,
    onSessionOpened: (sessionId: string) => observability.sessionOpened(sessionId),
    onSessionClosed: (sessionId: string) => observability.sessionClosed(sessionId)
  })
}

function rejectRequest(
  request: Request,
  options: NormalizedStreamableHttpOptions
): StreamableHttpExchange | undefined {
  const url = new URL(request.url)
  if (url.pathname !== options.path) {
    return staticExchange(new Response(null, { status: 404 }))
  }

  const hostError = validateHostHeader(request, options.allowedHosts)
  if (hostError !== undefined) {
    return staticExchange(jsonError(403, hostError))
  }

  const originError = validateOriginHeader(request, options.allowedOrigins)
  if (originError !== undefined) {
    return staticExchange(jsonError(403, originError))
  }

  return undefined
}

function preflightExchange(
  request: Request,
  cors: false | Required<StreamableHttpCorsOptions>
): StreamableHttpExchange {
  if (cors === false) {
    return staticExchange(jsonError(403, 'CORS is not enabled.'))
  }

  return staticExchange(
    new Response(null, {
      status: 204,
      headers: corsHeaders(request, cors)
    })
  )
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
