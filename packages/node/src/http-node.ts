import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import type {
  McpAppFactory,
  StreamableHttpOptions,
  StreamableHttpRuntime
} from './http-contracts.js'
import { createStreamableHttpHandler } from './http-handler.js'
import { requestUrlFromNodeRequest } from './proxy-resolution.js'
import { normalizeStreamableHttpOptions } from './http-security.js'

export async function runStreamableHttp<Services>(
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): Promise<StreamableHttpRuntime> {
  const normalized = normalizeStreamableHttpOptions(options)
  const handler = createStreamableHttpHandler(createApp, normalized)
  let draining = false
  const server = createServer((req, res) => {
    const controlResponse = controlEndpointResponse(req, normalized, draining)
    if (controlResponse !== undefined) {
      void writeResponse(res, controlResponse)
      return
    }
    void handleNodeRequest(
      req,
      res,
      handler,
      normalized.maxBodyBytes,
      normalized.trustedProxies
    ).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8'
        })
      }
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: status === 500 ? -32603 : -32000, message },
          id: null
        })
      )
    })
  })
  server.requestTimeout = normalized.requestTimeoutMs

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(normalized.port, normalized.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port =
    typeof address === 'object' && address !== null ? address.port : normalized.port
  const runtimeOptions = { ...normalized, port }
  const drain = (): Promise<void> => {
    draining = true
    return Promise.resolve()
  }

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    closing ??= (async () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      await drain()
      await closeSessions(runtimeOptions)
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    })()
    return closing
  }

  const onSignal = (): void => {
    void close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[error] Failed to close MCP HTTP server: ${message}\n`)
      process.exitCode = 1
    })
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  return {
    url: `http://${normalized.host}:${port}${normalized.path}`,
    options: runtimeOptions,
    drain,
    close
  }
}

async function closeSessions(options: StreamableHttpRuntime['options']): Promise<void> {
  const sessions = await options.sessionStore?.list()
  if (sessions === undefined) return
  await Promise.all(sessions.map((session) => session.close()))
}

async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: ReturnType<typeof createStreamableHttpHandler>,
  maxBodyBytes: number,
  trustedProxies: readonly string[]
): Promise<void> {
  const { request, parsedBody } = await buildRequest(
    req,
    maxBodyBytes,
    trustedProxies
  )
  const exchange = await handler({ request, parsedBody })

  try {
    await writeResponse(res, exchange.response)
  } finally {
    await exchange.close()
  }
}

async function buildRequest(
  req: IncomingMessage,
  maxBodyBytes: number,
  trustedProxies: readonly string[]
): Promise<{ request: Request; parsedBody?: unknown }> {
  const bodyText = await readBody(req, maxBodyBytes)
  const request = new Request(requestUrlFromNodeRequest(req, trustedProxies), {
    method: req.method ?? 'GET',
    headers: toHeaders(req),
    ...(bodyText === undefined ? {} : { body: bodyText })
  })
  return {
    request,
    ...(bodyText === undefined
      ? {}
      : { parsedBody: JSON.parse(bodyText) as unknown })
  }
}

async function readBody(
  req: IncomingMessage,
  maxBodyBytes: number
): Promise<string | undefined> {
  if (req.method !== 'POST') return undefined

  const lengthHeader = req.headers['content-length']
  const declaredLength =
    typeof lengthHeader === 'string' ? Number.parseInt(lengthHeader, 10) : NaN
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new HttpError(413, `Request body exceeds ${maxBodyBytes} bytes.`)
  }

  const chunks: Uint8Array[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer =
      typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBodyBytes) {
      throw new HttpError(413, `Request body exceeds ${maxBodyBytes} bytes.`)
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function writeResponse(
  res: ServerResponse,
  response: Response
): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (response.body === null) {
    res.end()
    return
  }

  await new Promise<void>((resolve, reject) => {
    const body = Readable.fromWeb(response.body as ReadableStream)
    body.on('error', reject)
    res.on('error', reject)
    res.on('finish', resolve)
    body.pipe(res)
  })
}

function controlEndpointResponse(
  req: IncomingMessage,
  options: StreamableHttpRuntime['options'],
  draining: boolean
): Response | undefined {
  if (req.method !== 'GET') return undefined
  const pathname = new URL(requestUrlFromNodeRequest(req, options.trustedProxies))
    .pathname

  if (options.healthPath !== false && pathname === options.healthPath) {
    return new Response(
      JSON.stringify({
        status: 'ok'
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
    )
  }

  if (options.readinessPath !== false && pathname === options.readinessPath) {
    return new Response(
      JSON.stringify({
        status: draining ? 'draining' : 'ready'
      }),
      {
        status: draining ? 503 : 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
    )
  }

  return undefined
}
