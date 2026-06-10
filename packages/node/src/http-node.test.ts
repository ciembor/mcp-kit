import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpApp } from '@mcp-kit/core'

type MockTransport = {
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
  handleRequest: ReturnType<
    typeof vi.fn<
      (request: Request, options?: { parsedBody?: unknown }) => Promise<Response>
    >
  >
}

const transportInstances: MockTransport[] = []
let handleRequestImpl: (
  request: Request,
  options?: { parsedBody?: unknown }
) => Promise<Response> = (request, options) =>
  new Response(
    JSON.stringify({
      pathname: new URL(request.url).pathname,
      body: options?.parsedBody ?? null
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  )

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class {
    close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    handleRequest = vi.fn(handleRequestImpl)

    constructor() {
      transportInstances.push(this)
    }
  }
}))

import { runStreamableHttp } from './http-node.js'

const runtimes: { close(): Promise<void> }[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  transportInstances.splice(0)
  handleRequestImpl = (request, options) =>
    new Response(
      JSON.stringify({
        pathname: new URL(request.url).pathname,
        body: options?.parsedBody ?? null
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
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
      pathname: '/mcp',
      body: { hello: 'world' }
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
  })

  it('rejects stateful mode until a SessionStore exists', async () => {
    const apps = createAppFactory()

    await expect(
      runStreamableHttp(apps.createApp, {
        port: 0,
        sessionMode: 'stateful'
      })
    ).rejects.toThrow('Stateful Streamable HTTP requires a SessionStore')
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
