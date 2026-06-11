import { randomUUID } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import type { AuthContext, McpApp } from '@mcp-kit/core'

import type {
  ManagedSession,
  McpAppFactory,
  NormalizedStreamableHttpOptions,
  StreamableHttpCorsOptions,
  StreamableHttpExchange,
  StreamableHttpHandler,
  StreamableHttpOptions,
  StreamableHttpRequest
} from './http-contracts.js'
import { authenticateRequest, sameAuthIdentity } from './http-auth.js'
import {
  corsHeaders,
  normalizeStreamableHttpOptions,
  validateHostHeader,
  validateOriginHeader
} from './http-security.js'
import { createStderrLogger } from './stderr-logger.js'

type ManagedTransportSession<Services> = ManagedSession & {
  readonly app: McpApp<Services>
  readonly transport: WebStandardStreamableHTTPServerTransport
}

export function createStreamableHttpHandler<Services>(
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): StreamableHttpHandler {
  const normalized = normalizeStreamableHttpOptions(options)
  let activeRequests = 0
  const closeSession = createSessionCloser(normalized)

  return async ({ request, parsedBody }: StreamableHttpRequest) => {
    const rejected = rejectRequest(request, normalized)
    if (rejected !== undefined) return rejected

    if (request.method === 'OPTIONS') {
      return preflightExchange(request, normalized.cors)
    }

    if (activeRequests >= normalized.maxConcurrency) {
      return staticExchange(
        jsonError(503, 'Too many concurrent MCP HTTP requests.')
      )
    }

    activeRequests += 1
    try {
      if (normalized.sessionMode === 'stateful') {
        return await handleStatefulRequest(
          createApp,
          normalized,
          request,
          parsedBody,
          closeSession
        )
      }
      return await handleStatelessRequest(
        createApp,
        normalized,
        request,
        parsedBody
      )
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

  const app = createConfiguredApp(createApp)
  const transport = new WebStandardStreamableHTTPServerTransport()

  try {
    await app.connect(transport)
    const response = await transport.handleRequest(request, {
      ...(parsedBody === undefined ? {} : { parsedBody }),
      ...(auth.authInfo === undefined ? {} : { authInfo: auth.authInfo })
    })
    return createClosableExchange(
      withCorsHeaders(response, request, options.cors),
      async () => {
        await transport.close()
        await app.close()
      }
    )
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
  closeSession: (sessionId: string) => Promise<void>
): Promise<StreamableHttpExchange> {
  const sessionStore = options.sessionStore
  if (sessionStore === undefined) {
    throw new Error('Stateful Streamable HTTP requires a SessionStore.')
  }

  const sessionId = request.headers.get('mcp-session-id')
  const session =
    sessionId === null ? undefined : await sessionStore.get(sessionId)

  if (sessionId !== null && session === undefined) {
    return staticExchange(jsonError(404, 'Unknown MCP session.'))
  }

  const auth = await authenticateRequest(request, options.auth)
  if (auth.rejection !== undefined) {
    return staticExchange(auth.rejection)
  }

  if (session !== undefined) {
    if (!sameAuthIdentity(session.auth, auth.auth)) {
      return staticExchange(
        jsonError(403, 'Session subject or tenant does not match this request.')
      )
    }
    const response = await session.handleRequest(request, parsedBody, auth.auth)
    return createClosableExchange(
      withCorsHeaders(response, request, options.cors),
      () => Promise.resolve()
    )
  }

  const nextSession = await createStatefulSession(
    createApp,
    options,
    closeSession
  )
  try {
    const response = await nextSession.handleRequest(
      request,
      parsedBody,
      auth.auth
    )
    if (nextSession.transport.sessionId === undefined) {
      await nextSession.close()
    } else {
      await sessionStore.set(nextSession.transport.sessionId, nextSession)
    }
    return createClosableExchange(
      withCorsHeaders(response, request, options.cors),
      () => Promise.resolve()
    )
  } catch (error) {
    await closeSession(nextSession.id)
    throw error
  }
}

async function createStatefulSession<Services>(
  createApp: McpAppFactory<Services>,
  options: NormalizedStreamableHttpOptions,
  closeSession: (sessionId: string) => Promise<void>
): Promise<ManagedTransportSession<Services>> {
  const sessionStore = options.sessionStore
  if (sessionStore === undefined) {
    throw new Error('Stateful Streamable HTTP requires a SessionStore.')
  }

  const app = createConfiguredApp(createApp)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessionclosed: async (sessionId) => {
      await closeSession(sessionId)
    }
  })

  const session: ManagedTransportSession<Services> = {
    get id() {
      return transport.sessionId ?? ''
    },
    get auth() {
      return activeAuth
    },
    app,
    transport,
    async close() {
      if (transport.sessionId !== undefined) {
        await sessionStore.delete(transport.sessionId)
      }
      await closeManagedResources(app, transport)
    },
    handleRequest(request, parsedBody, auth) {
      activeAuth = auth
      return transport.handleRequest(request, {
        ...(parsedBody === undefined ? {} : { parsedBody }),
        ...(auth === undefined ? {} : { authInfo: toAuthInfo(auth) })
      })
    }
  }
  let activeAuth: AuthContext | undefined

  try {
    await app.connect(transport)
  } catch (error) {
    await closeManagedResources(app, transport)
    throw error
  }

  return session
}

function createConfiguredApp<Services>(
  createApp: McpAppFactory<Services>
): McpApp<Services> {
  const app = createApp()
  app.setLogger(createStderrLogger())
  return app
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

function createSessionCloser(options: NormalizedStreamableHttpOptions) {
  return async (sessionId: string): Promise<void> => {
    const sessionStore = options.sessionStore
    if (sessionStore === undefined) return
    const session = await sessionStore.get(sessionId)
    if (session === undefined) return
    await sessionStore.delete(sessionId)
    await session.close()
  }
}

async function closeManagedResources(
  app: McpApp<unknown>,
  transport: WebStandardStreamableHTTPServerTransport
): Promise<void> {
  await transport.close().catch(() => undefined)
  await app.close().catch(() => undefined)
}

function toAuthInfo(auth: AuthContext) {
  return {
    token: auth.token ?? '',
    clientId: auth.clientId ?? 'mcp-kit',
    scopes: [...auth.scopes],
    ...(auth.expiresAt === undefined ? {} : { expiresAt: auth.expiresAt }),
    ...(auth.resource === undefined ? {} : { resource: auth.resource }),
    extra: {
      ...(auth.extra ?? {}),
      ...(auth.subject === undefined ? {} : { subject: auth.subject }),
      ...(auth.tenantId === undefined ? {} : { tenantId: auth.tenantId })
    }
  }
}

function createClosableExchange(
  response: Response,
  close: () => Promise<void>
): StreamableHttpExchange {
  let closing: Promise<void> | undefined
  return {
    response,
    close() {
      closing ??= close()
      return closing
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
