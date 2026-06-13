import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import {
  correlationHeaders,
  setCorrelationHeader,
  withCorrelationId
} from './correlation-id.js'
import {
  controlEndpointResponse,
  protectedResourceMetadataPath
} from './http-control-endpoints.js'
import type {
  McpAppFactory,
  StreamableHttpOptions,
  StreamableHttpRuntime
} from './http-contracts.js'
import { createStreamableHttpHandler } from './http-handler.js'
import { requestUrlFromNodeRequest } from './proxy-resolution.js'
import { normalizeStreamableHttpOptions } from './http-security.js'

export type NodeHttpRuntime = {
  readonly options: StreamableHttpRuntime['options']
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
  drain(): Promise<void>
  close(): Promise<void>
}

export { protectedResourceMetadataPath }

export function createNodeHttpRuntime<Services>(
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): NodeHttpRuntime {
  const normalized = normalizeStreamableHttpOptions(options)
  const handler = createStreamableHttpHandler(createApp, normalized)
  let draining = false
  let closing: Promise<void> | undefined

  return {
    options: normalized,
    handle: (req, res) =>
      handleNodeRequest({
        req,
        res,
        options: normalized,
        handler,
        draining
      }),
    drain() {
      draining = true
      return Promise.resolve()
    },
    close() {
      closing ??= closeSessions(normalized)
      return closing
    }
  }
}

async function handleNodeRequest(args: {
  req: IncomingMessage
  res: ServerResponse
  options: StreamableHttpRuntime['options']
  handler: ReturnType<typeof createStreamableHttpHandler>
  draining: boolean
}): Promise<void> {
  const correlationId = correlationHeaders(
    args.req,
    args.options.trustedProxies
  )
  const controlResponse = controlEndpointResponse(
    args.req,
    args.options,
    args.draining
  )
  if (controlResponse !== undefined) {
    await writeResponse(
      args.res,
      withCorrelationId(controlResponse, correlationId)
    )
    return
  }

  try {
    const exchange = await dynamicRequestExchange(
      args.req,
      correlationId,
      args.options,
      args.handler
    )
    try {
      await writeResponse(
        args.res,
        withCorrelationId(exchange.response, correlationId)
      )
    } finally {
      await exchange.close()
    }
  } catch (error) {
    writeRuntimeError(args.res, correlationId, error)
  }
}

async function closeSessions(
  options: StreamableHttpRuntime['options']
): Promise<void> {
  const sessions = await options.sessionStore?.list()
  if (sessions === undefined) return
  await Promise.all(sessions.map((session) => session.close()))
}

async function buildRequest(
  req: IncomingMessage,
  correlationId: string,
  maxBodyBytes: number,
  trustedProxies: readonly string[]
): Promise<{ request: Request; parsedBody?: unknown }> {
  const bodyText = await readBody(req, maxBodyBytes)
  const headers = toHeaders(req)
  setCorrelationHeader(headers, correlationId)
  const request = new Request(requestUrlFromNodeRequest(req, trustedProxies), {
    method: req.method ?? 'GET',
    headers,
    ...(bodyText === undefined ? {} : { body: bodyText })
  })
  return {
    request,
    ...(bodyText === undefined
      ? {}
      : { parsedBody: JSON.parse(bodyText) as unknown })
  }
}

async function dynamicRequestExchange(
  req: IncomingMessage,
  correlationId: string,
  options: StreamableHttpRuntime['options'],
  handler: ReturnType<typeof createStreamableHttpHandler>
) {
  const { request, parsedBody } = await buildRequest(
    req,
    correlationId,
    options.maxBodyBytes,
    options.trustedProxies
  )
  return await handler({ request, parsedBody })
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
    const buffer = Buffer.from(chunk)
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

function writeRuntimeError(
  res: ServerResponse,
  correlationId: string,
  error: unknown
): void {
  const status = error instanceof HttpError ? error.status : 500
  const message = error instanceof Error ? error.message : String(error)
  if (!res.headersSent) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'x-correlation-id': correlationId
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
