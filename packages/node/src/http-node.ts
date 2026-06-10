import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import type {
  McpAppFactory,
  StreamableHttpOptions,
  StreamableHttpRuntime
} from './http-contracts.js'
import { createStreamableHttpHandler } from './http-handler.js'
import { normalizeStreamableHttpOptions } from './http-security.js'

export async function runStreamableHttp<Services>(
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): Promise<StreamableHttpRuntime> {
  const normalized = normalizeStreamableHttpOptions(options)
  const handler = createStreamableHttpHandler(createApp, normalized)
  const server = createServer((req, res) => {
    void handleNodeRequest(req, res, handler, normalized.maxBodyBytes).catch(
      (error: unknown) => {
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
      }
    )
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

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolve, reject) => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
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
    close
  }
}

async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: ReturnType<typeof createStreamableHttpHandler>,
  maxBodyBytes: number
): Promise<void> {
  const bodyText = await readBody(req, maxBodyBytes)
  const request = new Request(toRequestUrl(req), {
    method: req.method ?? 'GET',
    headers: toHeaders(req),
    ...(bodyText === undefined ? {} : { body: bodyText })
  })
  const parsedBody =
    bodyText === undefined ? undefined : (JSON.parse(bodyText) as unknown)
  const exchange = await handler({ request, parsedBody })

  try {
    res.statusCode = exchange.response.status
    exchange.response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    if (exchange.response.body === null) {
      res.end()
      return
    }

    await new Promise<void>((resolve, reject) => {
      const body = Readable.fromWeb(exchange.response.body as ReadableStream)
      body.on('error', reject)
      res.on('error', reject)
      res.on('finish', resolve)
      body.pipe(res)
    })
  } finally {
    await exchange.close()
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

function toRequestUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? '127.0.0.1'
  const protocol = 'encrypted' in req.socket ? 'https' : 'http'
  return `${protocol}://${host}${req.url ?? '/'}`
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}
