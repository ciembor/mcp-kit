import { request as httpRequest } from 'node:http'
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

import { runStreamableHttp } from './http-node.js'

const runtimes: { close(): Promise<void> }[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
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

describe('@mcp-kit/node streamable http', () => {
  it('serves stateless HTTP with safe defaults', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, { port: 0 })
    runtimes.push(runtime)

    const response = await fetch(runtime.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })

    expect(runtime.options.host).toBe('127.0.0.1')
    expect(runtime.options.sessionMode).toBe('stateless')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: runtime.url,
      pathname: '/mcp',
      body: { hello: 'world' },
      auth: null
    })
    expect(apps.instances).toHaveLength(1)
    expect(apps.instances[0]?.setLogger).toHaveBeenCalledTimes(1)
    expect(apps.instances[0]?.connect).toHaveBeenCalledTimes(1)
    expect(apps.instances[0]?.close).toHaveBeenCalledTimes(1)
    expect(transportInstances[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('rejects disallowed Host headers before touching the app', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, { port: 0 })
    runtimes.push(runtime)

    const response = await sendNodeRequest(runtime.url, {
      method: 'POST',
      headers: {
        host: 'evil.example',
        'content-type': 'application/json'
      },
      body: '{"hello":"world"}'
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({
      error: { message: 'Host "evil.example" is not allowed.' }
    })
    expect(apps.instances).toHaveLength(0)
  })

  it('validates Origin headers and only enables explicit CORS', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      allowedOrigins: ['https://client.example'],
      cors: {}
    })
    runtimes.push(runtime)

    const preflight = await sendNodeRequest(runtime.url, {
      method: 'OPTIONS',
      headers: {
        host: `127.0.0.1:${runtime.options.port}`,
        origin: 'https://client.example',
        'access-control-request-method': 'POST'
      }
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://client.example'
    )

    const rejected = await sendNodeRequest(runtime.url, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${runtime.options.port}`,
        origin: 'https://evil.example',
        'content-type': 'application/json'
      },
      body: '{"hello":"world"}'
    })
    expect(rejected.status).toBe(403)
    expect(JSON.parse(rejected.body)).toMatchObject({
      error: { message: 'Origin "https://evil.example" is not allowed.' }
    })
    expect(apps.instances).toHaveLength(0)
  })

  it('returns 413 when the body exceeds the configured limit', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      maxBodyBytes: 8
    })
    runtimes.push(runtime)

    const response = await sendNodeRequest(runtime.url, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${runtime.options.port}`,
        'content-type': 'application/json'
      },
      body: '{"hello":"world"}'
    })

    expect(response.status).toBe(413)
    expect(response.body).toContain('Request body exceeds 8 bytes.')
    expect(apps.instances).toHaveLength(0)
  })

  it('rejects excess concurrent requests', async () => {
    let release: (() => void) | undefined
    handleRequestImpl = async () =>
      await new Promise<Response>((resolve) => {
        release = () => resolve(new Response('ok'))
      })

    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      maxConcurrency: 1
    })
    runtimes.push(runtime)

    const first = fetch(runtime.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"hello":"world"}'
    })

    await waitFor(() => apps.instances.length === 1)

    const second = await fetch(runtime.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"hello":"again"}'
    })

    expect(second.status).toBe(503)
    release?.()
    await first
  })

  it('serves health/readiness endpoints and marks drain state', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, { port: 0 })
    runtimes.push(runtime)

    const health = await fetch(
      `http://127.0.0.1:${runtime.options.port}${runtime.options.healthPath}`
    )
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toEqual({ status: 'ok' })

    const ready = await fetch(
      `http://127.0.0.1:${runtime.options.port}${runtime.options.readinessPath}`
    )
    expect(ready.status).toBe(200)
    await expect(ready.json()).resolves.toEqual({ status: 'ready' })

    await runtime.drain()

    const draining = await fetch(
      `http://127.0.0.1:${runtime.options.port}${runtime.options.readinessPath}`
    )
    expect(draining.status).toBe(503)
    await expect(draining.json()).resolves.toEqual({ status: 'draining' })
  })

  it('waits for in-flight requests before close resolves', async () => {
    let release: (() => void) | undefined
    handleRequestImpl = async () =>
      await new Promise<Response>((resolve) => {
        release = () => resolve(new Response('ok'))
      })

    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, { port: 0 })
    runtimes.push(runtime)

    const request = fetch(runtime.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"hello":"world"}'
    })

    await waitFor(() => apps.instances.length === 1)

    let closed = false
    const closePromise = runtime.close().then(() => {
      closed = true
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(closed).toBe(false)

    release?.()

    await closePromise
    const response = await request
    expect(response.status).toBe(200)
    expect(closed).toBe(true)
  })

  it('requires explicit public deployment settings', async () => {
    const apps = createAppFactory()

    await expect(
      runStreamableHttp(apps.createApp, { host: '0.0.0.0', port: 0 })
    ).rejects.toThrow('explicit deployment mode')

    await expect(
      runStreamableHttp(apps.createApp, {
        host: '0.0.0.0',
        mode: 'production',
        port: 0
      })
    ).rejects.toThrow('trusted proxies')

    await expect(
      runStreamableHttp(apps.createApp, {
        host: 'api.example',
        mode: 'production',
        port: 0
      })
    ).rejects.toThrow('explicit auth decision')
  })

  it('uses forwarded host and proto only from trusted proxies', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      trustedProxies: ['127.0.0.1']
    })
    runtimes.push(runtime)

    const response = await sendNodeRequest(runtime.url, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${runtime.options.port}`,
        forwarded: 'for=127.0.0.1;proto=https;host=public.example',
        'content-type': 'application/json'
      },
      body: '{"hello":"world"}'
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      url: 'https://public.example/mcp'
    })
  })

  it('ignores forwarded headers from untrusted clients', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, { port: 0 })
    runtimes.push(runtime)

    const response = await sendNodeRequest(runtime.url, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${runtime.options.port}`,
        forwarded: 'for=127.0.0.1;proto=https;host=public.example',
        'content-type': 'application/json'
      },
      body: '{"hello":"world"}'
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      url: `http://127.0.0.1:${runtime.options.port}/mcp`
    })
  })

  it('creates cryptographic session ids and reuses stateful sessions', async () => {
    const apps = createAppFactory()
    const sessionStore = createInMemorySessionStore()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      sessionMode: 'stateful',
      sessionStore
    })
    runtimes.push(runtime)

    const initialize = await fetch(runtime.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      })
    })
    const sessionId = initialize.headers.get('mcp-session-id')

    expect(initialize.status).toBe(200)
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(apps.instances).toHaveLength(1)
    expect(await sessionStore.get(sessionId ?? '')).toBeDefined()

    const followUp = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': sessionId ?? ''
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    })

    expect(followUp.status).toBe(200)
    expect(apps.instances).toHaveLength(1)
    expect(transportInstances).toHaveLength(1)
    expect(transportInstances[0]?.handleRequest).toHaveBeenCalledTimes(2)
  })

  it('removes stateful sessions on DELETE', async () => {
    const apps = createAppFactory()
    const sessionStore = createInMemorySessionStore()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      sessionMode: 'stateful',
      sessionStore
    })
    runtimes.push(runtime)

    const initialize = await fetch(runtime.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      })
    })
    const sessionId = initialize.headers.get('mcp-session-id') ?? ''

    const response = await fetch(runtime.url, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId }
    })

    expect(response.status).toBe(204)
    expect(await sessionStore.get(sessionId)).toBeUndefined()
    expect(apps.instances[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('requires an explicit SessionStore for stateful production', async () => {
    const apps = createAppFactory()

    await expect(
      runStreamableHttp(apps.createApp, {
        port: 0,
        mode: 'production',
        sessionMode: 'stateful'
      })
    ).rejects.toThrow('explicit SessionStore')
  })

  it('rejects missing bearer tokens when auth middleware is enabled', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      auth: {
        verifyBearerToken: createVerifier()
      }
    })
    runtimes.push(runtime)

    const response = await fetch(runtime.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"hello":"world"}'
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Bearer')
    expect(apps.instances).toHaveLength(0)
  })

  it('passes bearer auth into request handling', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      auth: {
        verifyBearerToken: createVerifier()
      }
    })
    runtimes.push(runtime)

    const response = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer alice-token'
      },
      body: '{"hello":"world"}'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: runtime.url,
      pathname: '/mcp',
      body: { hello: 'world' },
      auth: { subject: 'alice', tenantId: 'tenant-a' }
    })
  })

  it('serves protected resource metadata for authenticated HTTP servers', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      trustedProxies: ['127.0.0.1'],
      auth: {
        verifyBearerToken: createVerifier(),
        metadata: {
          authorizationServers: ['https://auth.example/.well-known/oauth'],
          scopesSupported: ['users:read'],
          resourceName: 'Test MCP',
          serviceDocumentationUrl: 'https://docs.example/mcp'
        }
      }
    })
    runtimes.push(runtime)

    const response = await sendNodeRequest(
      `http://127.0.0.1:${runtime.options.port}/.well-known/oauth-protected-resource/mcp`,
      {
        method: 'GET',
        headers: {
          host: `127.0.0.1:${runtime.options.port}`,
          forwarded: 'for=127.0.0.1;proto=https;host=public.example'
        }
      }
    )

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      resource: 'https://public.example/mcp',
      authorization_servers: ['https://auth.example/.well-known/oauth'],
      scopes_supported: ['users:read'],
      resource_name: 'Test MCP',
      resource_documentation: 'https://docs.example/mcp',
      bearer_methods_supported: ['header']
    })
  })

  it('rejects invalid bearer tokens', async () => {
    const apps = createAppFactory()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      auth: {
        verifyBearerToken: createVerifier()
      }
    })
    runtimes.push(runtime)

    const response = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer missing-token'
      },
      body: '{"hello":"world"}'
    })

    expect(response.status).toBe(401)
    expect(await response.text()).toContain('Bearer token rejected.')
  })

  it('binds stateful sessions to subject and tenant on every request', async () => {
    const apps = createAppFactory()
    const sessionStore = createInMemorySessionStore()
    const runtime = await runStreamableHttp(apps.createApp, {
      port: 0,
      sessionMode: 'stateful',
      sessionStore,
      auth: {
        verifyBearerToken: createVerifier()
      }
    })
    runtimes.push(runtime)

    const initialize = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer alice-token'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    })
    const sessionId = initialize.headers.get('mcp-session-id') ?? ''

    const followUp = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer alice-token',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    })
    expect(followUp.status).toBe(200)

    const hijack = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer bob-token',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    })

    expect(hijack.status).toBe(403)
    expect(JSON.parse(await hijack.text())).toMatchObject({
      error: {
        message: 'Session subject or tenant does not match this request.'
      }
    })
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

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for predicate.')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function createVerifier() {
  return (token: string) => {
    switch (token) {
      case 'alice-token':
        return {
          source: 'oauth' as const,
          clientId: 'client-1',
          subject: 'alice',
          tenantId: 'tenant-a',
          scopes: ['users:read']
        }
      case 'bob-token':
        return {
          source: 'oauth' as const,
          clientId: 'client-2',
          subject: 'bob',
          tenantId: 'tenant-b',
          scopes: ['users:read']
        }
      default:
        throw new Error(`Unknown token: ${token}`)
    }
  }
}
