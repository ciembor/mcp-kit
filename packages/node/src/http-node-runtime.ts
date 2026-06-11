import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

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
    async handle(req, res) {
      const controlResponse = controlEndpointResponse(req, normalized, draining)
      if (controlResponse !== undefined) {
        await writeResponse(res, controlResponse)
        return
      }

      try {
        const { request, parsedBody } = await buildRequest(
          req,
          normalized.maxBodyBytes,
          normalized.trustedProxies
        )
        const exchange = await handler({ request, parsedBody })
        try {
          await writeResponse(res, exchange.response)
        } finally {
          await exchange.close()
        }
      } catch (error) {
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
    },
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

async function closeSessions(
  options: StreamableHttpRuntime['options']
): Promise<void> {
  const sessions = await options.sessionStore?.list()
  if (sessions === undefined) return
  await Promise.all(sessions.map((session) => session.close()))
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
  const requestUrl = new URL(
    requestUrlFromNodeRequest(req, options.trustedProxies)
  )
  const pathname = requestUrl.pathname

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

  const metadataPath = protectedResourceMetadataPath(options.path)
  if (
    options.auth !== false &&
    options.auth !== undefined &&
    options.auth.metadata !== undefined &&
    pathname === metadataPath
  ) {
    return new Response(
      JSON.stringify({
        resource: canonicalResourceUrl(requestUrl, options.path).toString(),
        ...(options.auth.metadata.authorizationServers === undefined
          ? {}
          : {
              authorization_servers: [
                ...options.auth.metadata.authorizationServers
              ]
            }),
        ...(options.auth.metadata.scopesSupported === undefined
          ? {}
          : { scopes_supported: [...options.auth.metadata.scopesSupported] }),
        ...(options.auth.metadata.resourceName === undefined
          ? {}
          : { resource_name: options.auth.metadata.resourceName }),
        ...(options.auth.metadata.serviceDocumentationUrl === undefined
          ? {}
          : {
              resource_documentation:
                options.auth.metadata.serviceDocumentationUrl
            }),
        bearer_methods_supported: ['header']
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
    )
  }

  return undefined
}

export function protectedResourceMetadataPath(path: string): string {
  return `/.well-known/oauth-protected-resource${path}`
}

function canonicalResourceUrl(requestUrl: URL, path: string): URL {
  const url = new URL(requestUrl.toString())
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url
}
