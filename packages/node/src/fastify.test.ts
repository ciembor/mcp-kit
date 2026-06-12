import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpApp } from '@mcp-kit/core'

import { createInMemorySessionStore } from './session-store.js'

type MockTransport = {
  readonly sessionId: string | undefined
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
  handleRequest: ReturnType<
    typeof vi.fn<
      (
        request: Request,
        options?: {
          parsedBody?: unknown
          authInfo?: {
            clientId: string
            scopes: readonly string[]
            extra?: Record<string, unknown>
          }
        }
      ) => Promise<Response>
    >
  >
}

type MockTransportOptions = {
  sessionIdGenerator?: () => string
  onsessionclosed?: (sessionId: string) => Promise<void> | void
}

type FakeFastifyRoute = {
  method: string | readonly string[]
  url: string
  handler(
    request: { raw: IncomingMessage },
    reply: { raw: ServerResponse }
  ): Promise<void> | void
}

const transportInstances: MockTransport[] = []
let handleRequestImpl: (
  request: Request,
  options?: {
    parsedBody?: unknown
    authInfo?: {
      clientId: string
      scopes: readonly string[]
      extra?: Record<string, unknown>
    }
  }
) => Promise<Response> = (request, options) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        url: request.url,
        pathname: new URL(request.url).pathname,
        body: options?.parsedBody ?? null,
        auth: options?.authInfo?.extra ?? null
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
    )
  )

vi.mock(
  '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js',
  () => ({
    WebStandardStreamableHTTPServerTransport: class {
      readonly options: MockTransportOptions | undefined
      sessionId: string | undefined
      close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      handleRequest = vi.fn(
        async (
          request: Request,
          options?: {
            parsedBody?: unknown
            authInfo?: {
              clientId: string
              scopes: readonly string[]
              extra?: Record<string, unknown>
            }
          }
        ) => {
          if (
            request.method === 'POST' &&
            this.sessionId === undefined &&
            this.options?.sessionIdGenerator !== undefined
          ) {
            this.sessionId = this.options.sessionIdGenerator()
          }

          if (request.method === 'DELETE' && this.sessionId !== undefined) {
            const closedSession = this.sessionId
            this.sessionId = undefined
            await this.options?.onsessionclosed?.(closedSession)
            return new Response(null, { status: 204 })
          }

          const response = await handleRequestImpl(request, options)
          if (this.sessionId === undefined) return response
          const headers = new Headers(response.headers)
          headers.set('mcp-session-id', this.sessionId)
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
          })
        }
      )

      constructor(options?: MockTransportOptions) {
        this.options = options
        transportInstances.push(this)
      }
    }
  })
)

import { registerFastifyStreamableHttp } from './fastify.js'

const runtimes: { close(): Promise<void> }[] = []
const servers: { close(): Promise<void> }[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  await Promise.all(servers.splice(0).map((server) => server.close()))
  transportInstances.splice(0)
  handleRequestImpl = (request, options) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          url: request.url,
          pathname: new URL(request.url).pathname,
          body: options?.parsedBody ?? null,
          auth: options?.authInfo?.extra ?? null
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        }
      )
    )
  vi.restoreAllMocks()
})

describe('@mcp-kit/node fastify adapter', () => {
  it('registers MCP routes on a Fastify host and preserves HTTP policy', async () => {
    const apps = createAppFactory()
    const fastify = createFakeFastify()
    const runtime = registerFastifyStreamableHttp(fastify, apps.createApp, {
      allowedOrigins: ['https://client.example'],
      cors: {},
      auth: {
        verifyBearerToken: createVerifier(),
        metadata: {
          authorizationServers: ['https://auth.example/.well-known/oauth'],
          scopesSupported: ['users:read']
        }
      }
    })
    runtimes.push(runtime)

    expect(fastify.routes.map((route) => route.url).sort()).toEqual([
      '/.well-known/oauth-protected-resource/mcp',
      '/healthz',
      '/mcp',
      '/readyz'
    ])

    const server = await startFakeFastifyServer(fastify)
    servers.push(server)

    const preflight = await sendNodeRequest(`${server.url}/mcp`, {
      method: 'OPTIONS',
      headers: {
        host: server.host,
        origin: 'https://client.example',
        'access-control-request-method': 'POST'
      }
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://client.example'
    )

    const response = await sendNodeRequest(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        host: server.host,
        authorization: 'Bearer alice-token',
        'content-type': 'application/json'
      },
      body: '{"hello":"world"}'
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      url: `${server.url}/mcp`,
      pathname: '/mcp',
      body: { hello: 'world' },
      auth: { subject: 'alice', tenantId: 'tenant-a' }
    })

    const metadata = await sendNodeRequest(
      `${server.url}/.well-known/oauth-protected-resource/mcp`,
      {
        method: 'GET',
        headers: { host: server.host }
      }
    )
    expect(metadata.status).toBe(200)
    expect(JSON.parse(metadata.body)).toMatchObject({
      resource: `${server.url}/mcp`,
      authorization_servers: ['https://auth.example/.well-known/oauth'],
      scopes_supported: ['users:read'],
      bearer_methods_supported: ['header']
    })

    const ready = await sendNodeRequest(`${server.url}/readyz`, {
      method: 'GET',
      headers: { host: server.host }
    })
    expect(ready.status).toBe(200)
    expect(JSON.parse(ready.body)).toEqual({ status: 'ready' })

    await runtime.drain()

    const draining = await sendNodeRequest(`${server.url}/readyz`, {
      method: 'GET',
      headers: { host: server.host }
    })
    expect(draining.status).toBe(503)
    expect(JSON.parse(draining.body)).toEqual({ status: 'draining' })
  })

  it('closes active sessions from the Fastify onClose hook', async () => {
    const apps = createAppFactory()
    const sessionStore = createInMemorySessionStore()
    const fastify = createFakeFastify()
    const runtime = registerFastifyStreamableHttp(fastify, apps.createApp, {
      sessionMode: 'stateful',
      sessionStore
    })
    runtimes.push(runtime)

    const server = await startFakeFastifyServer(fastify)
    servers.push(server)

    const initialize = await sendNodeRequest(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        host: server.host,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    })
    const sessionId = initialize.headers['mcp-session-id'] ?? ''

    expect(sessionId).toBeTruthy()
    expect(await sessionStore.get(sessionId)).toBeDefined()

    await fastify.close()

    expect(await sessionStore.get(sessionId)).toBeUndefined()
    expect(apps.instances[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('skips protected resource metadata routes when auth metadata is unavailable', () => {
    const apps = createAppFactory()
    const withoutMetadata = createFakeFastify()
    const authDisabled = createFakeFastify()

    registerFastifyStreamableHttp(withoutMetadata, apps.createApp, {
      auth: {
        verifyBearerToken: createVerifier()
      },
      healthPath: false,
      readinessPath: false
    })
    registerFastifyStreamableHttp(authDisabled, apps.createApp, {
      auth: false,
      healthPath: false,
      readinessPath: false
    })

    expect(withoutMetadata.routes.map((route) => route.url)).toEqual(['/mcp'])
    expect(authDisabled.routes.map((route) => route.url)).toEqual(['/mcp'])
  })
})

function createAppFactory() {
  const instances: {
    setLogger: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn<() => Promise<void>>>
    close: ReturnType<typeof vi.fn<() => Promise<void>>>
  }[] = []

  return {
    instances,
    createApp: () => {
      const app = {
        setLogger: vi.fn(),
        connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      }
      instances.push(app)
      return app as unknown as McpApp<unknown>
    }
  }
}

function createFakeFastify() {
  const routes: FakeFastifyRoute[] = []
  const closeHooks: Array<() => Promise<void> | void> = []
  let closing: Promise<void> | undefined

  return {
    routes,
    route(route: FakeFastifyRoute) {
      routes.push(route)
    },
    addHook(
      name: 'onClose',
      hook: (...args: readonly unknown[]) => Promise<void> | void
    ) {
      if (name === 'onClose') {
        closeHooks.push(() => hook())
      }
    },
    close() {
      closing ??= Promise.all(
        closeHooks.map((hook) => Promise.resolve(hook()))
      ).then(() => {})
      return closing
    }
  }
}

async function startFakeFastifyServer(fastify: {
  routes: readonly FakeFastifyRoute[]
}): Promise<{ url: string; host: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const route = fastify.routes.find((candidate) => {
      const methods = Array.isArray(candidate.method)
        ? candidate.method
        : [candidate.method]
      return candidate.url === pathname && methods.includes(req.method ?? 'GET')
    })

    if (route === undefined) {
      res.statusCode = 404
      res.end()
      return
    }

    Promise.resolve(route.handler({ raw: req }, { raw: res })).catch(
      (error: unknown) => {
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('content-type', 'text/plain; charset=utf-8')
        }
        res.end(error instanceof Error ? error.message : String(error))
      }
    )
  })

  let port = 0
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (typeof address !== 'object' || address === null) {
        reject(new Error('Server did not expose a socket address.'))
        return
      }
      port = address.port
      resolve()
    })
  })

  return {
    url: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
  }
}

async function sendNodeRequest(
  url: string,
  input: {
    method: string
    headers: Record<string, string>
    body?: string
  }
): Promise<{
  status: number
  headers: Record<string, string>
  body: string
}> {
  const target = new URL(url)
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      target,
      {
        method: input.method,
        headers: input.headers
      },
      (response) => {
        const chunks: Uint8Array[] = []
        response.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk))
        })
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).flatMap(([key, value]) =>
                value === undefined
                  ? []
                  : [[key, Array.isArray(value) ? value.join(', ') : value]]
              )
            ),
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )
    request.on('error', reject)
    request.end(input.body)
  })
}

function createVerifier() {
  return (token: string) => {
    if (token !== 'alice-token') {
      throw new Error(`Unknown token: ${token}`)
    }
    return {
      source: 'oauth' as const,
      clientId: 'client-1',
      subject: 'alice',
      tenantId: 'tenant-a',
      scopes: ['users:read']
    }
  }
}
