import { randomUUID } from 'node:crypto'

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import type { AuthContext, McpApp } from '@mcp-kit/core'

import type {
  ManagedSession,
  McpAppFactory,
  NormalizedStreamableHttpOptions,
  StreamableHttpCorsOptions,
  StreamableHttpExchange
} from './http-contracts.js'
import { sameAuthIdentity } from './http-auth.js'
import { corsHeaders } from './http-security.js'
import { createStderrLogger } from './stderr-logger.js'

type ManagedTransportSession<Services> = ManagedSession & {
  readonly app: McpApp<Services>
  readonly transport: WebStandardStreamableHTTPServerTransport
}

export async function existingSession(
  request: Request,
  sessionStore: NonNullable<NormalizedStreamableHttpOptions['sessionStore']>
) {
  const sessionId = request.headers.get('mcp-session-id')
  if (sessionId === null) return undefined
  return (await sessionStore.get(sessionId)) ?? 'missing'
}

export async function existingSessionExchange(args: {
  session: ManagedSession
  auth: AuthContext | undefined
  request: Request
  parsedBody: unknown
  cors: false | Required<StreamableHttpCorsOptions>
}): Promise<StreamableHttpExchange> {
  if (!sameAuthIdentity(args.session.auth, args.auth)) {
    return staticExchange(
      jsonError(403, 'Session subject or tenant does not match this request.')
    )
  }
  const response = await args.session.handleRequest(
    args.request,
    args.parsedBody,
    args.auth
  )
  return createResponseExchange(response, args.request, args.cors)
}

export async function newStatefulSessionExchange<Services>(args: {
  createValidatedApp: McpAppFactory<Services>
  options: NormalizedStreamableHttpOptions
  request: Request
  parsedBody: unknown
  auth: AuthContext | undefined
  sessionStore: NonNullable<NormalizedStreamableHttpOptions['sessionStore']>
  onSessionOpened?: (sessionId: string) => Promise<void>
  onSessionClosed?: (sessionId: string) => Promise<void>
}): Promise<StreamableHttpExchange> {
  const closeSession = createSessionCloser(
    args.sessionStore,
    args.onSessionClosed
  )
  const nextSession = await createStatefulSession(
    args.createValidatedApp,
    args.options,
    closeSession,
    args.onSessionClosed
  )
  try {
    const response = await nextSession.handleRequest(
      args.request,
      args.parsedBody,
      args.auth
    )
    await persistStatefulSession(
      nextSession,
      args.sessionStore,
      args.onSessionOpened
    )
    return createResponseExchange(response, args.request, args.options.cors)
  } catch (error) {
    await closeSession(nextSession.id)
    throw error
  }
}

export function createResponseExchange(
  response: Response,
  request: Request,
  cors: false | Required<StreamableHttpCorsOptions>,
  close: () => Promise<void> = () => Promise.resolve()
): StreamableHttpExchange {
  return createClosableExchange(withCorsHeaders(response, request, cors), close)
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

export async function closeManagedResources(
  app: McpApp<unknown>,
  transport: WebStandardStreamableHTTPServerTransport
): Promise<void> {
  await transport.close().catch(() => undefined)
  await app.close().catch(() => undefined)
}

export function createConfiguredApp<Services>(
  createApp: McpAppFactory<Services>
): McpApp<Services> {
  const app = createApp()
  app.setLogger(createStderrLogger())
  return app
}

export function createTransportOptions(
  options: NormalizedStreamableHttpOptions
): ConstructorParameters<typeof WebStandardStreamableHTTPServerTransport>[0] {
  return {
    ...(options.eventStore === undefined
      ? {}
      : { eventStore: options.eventStore }),
    ...(options.retryIntervalMs === undefined
      ? {}
      : { retryInterval: options.retryIntervalMs })
  }
}

function createSessionCloser(
  sessionStore: NonNullable<NormalizedStreamableHttpOptions['sessionStore']>,
  onSessionClosed?: (sessionId: string) => Promise<void>
) {
  return async (sessionId: string): Promise<void> => {
    const session = await sessionStore.get(sessionId)
    if (session === undefined) return
    await sessionStore.delete(sessionId)
    await onSessionClosed?.(sessionId)
    await session.close()
  }
}

async function createStatefulSession<Services>(
  createApp: McpAppFactory<Services>,
  options: NormalizedStreamableHttpOptions,
  closeSession: (sessionId: string) => Promise<void>,
  onSessionClosed?: (sessionId: string) => Promise<void>
): Promise<ManagedTransportSession<Services>> {
  const sessionStore = options.sessionStore
  if (sessionStore === undefined) {
    throw new Error('Stateful Streamable HTTP requires a SessionStore.')
  }

  const app = createConfiguredApp(createApp)
  const transport = new WebStandardStreamableHTTPServerTransport({
    ...createTransportOptions(options),
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
        await onSessionClosed?.(transport.sessionId)
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

async function persistStatefulSession(
  session: ManagedTransportSession<unknown>,
  sessionStore: NonNullable<NormalizedStreamableHttpOptions['sessionStore']>,
  onSessionOpened?: (sessionId: string) => Promise<void>
): Promise<void> {
  if (session.transport.sessionId === undefined) {
    await session.close()
    return
  }
  await sessionStore.set(session.transport.sessionId, session)
  await onSessionOpened?.(session.transport.sessionId)
}

function toAuthInfo(auth: AuthContext) {
  return {
    token: '',
    clientId: auth.clientId ?? 'mcp-kit',
    scopes: [...auth.scopes],
    ...(auth.expiresAt === undefined ? {} : { expiresAt: auth.expiresAt }),
    ...(auth.resource === undefined ? {} : { resource: auth.resource }),
    extra: {
      ...(auth.extra ?? {}),
      ...(auth.subject === undefined ? {} : { subject: auth.subject }),
      ...(auth.tenantId === undefined ? {} : { tenantId: auth.tenantId }),
      ...(auth.authorization === undefined
        ? {}
        : { authorization: auth.authorization })
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
