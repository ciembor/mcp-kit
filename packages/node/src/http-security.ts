import type {
  NormalizedStreamableHttpOptions,
  StreamableHttpCorsOptions,
  StreamableHttpOptions
} from './http-contracts.js'

const loopbackHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

export function normalizeStreamableHttpOptions(
  options: StreamableHttpOptions = {}
): NormalizedStreamableHttpOptions {
  const mode = options.mode ?? detectDeploymentMode()
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3000
  const path = normalizePath(options.path ?? '/mcp')
  const sessionMode = options.sessionMode ?? 'stateless'
  const trustedProxies = freeze(options.trustedProxies ?? [])
  const allowedOrigins = freeze(options.allowedOrigins ?? [])
  const cors = normalizeCors(options.cors)

  if (sessionMode === 'stateful') {
    throw new Error(
      'Stateful Streamable HTTP requires a SessionStore and is not implemented yet.'
    )
  }

  if (host === '0.0.0.0') {
    if (options.mode === undefined) {
      throw new Error(
        'Binding Streamable HTTP to 0.0.0.0 requires an explicit deployment mode.'
      )
    }
    if (trustedProxies.length === 0) {
      throw new Error(
        'Binding Streamable HTTP to 0.0.0.0 requires explicit trusted proxies.'
      )
    }
  }

  if (cors !== false && allowedOrigins.length === 0) {
    throw new Error(
      'CORS requires explicit allowedOrigins; wildcard browser access is not enabled by default.'
    )
  }

  const allowedHosts = freeze(options.allowedHosts ?? defaultAllowedHosts(host, port))

  return {
    mode,
    host,
    port,
    path,
    sessionMode,
    trustedProxies,
    allowedHosts,
    allowedOrigins,
    cors,
    maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
    requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
    maxConcurrency: options.maxConcurrency ?? 16
  }
}

export function validateHostHeader(
  request: Request,
  allowedHosts: readonly string[]
): string | undefined {
  const hostHeader = request.headers.get('host')
  if (hostHeader === null) return 'Missing Host header.'

  const normalized = normalizeHostValue(hostHeader)
  const hostname = hostNameOnly(normalized)
  if (
    allowedHosts.some((allowedHost) => {
      const normalizedAllowed = normalizeHostValue(allowedHost)
      return (
        normalizedAllowed === normalized ||
        hostNameOnly(normalizedAllowed) === hostname
      )
    })
  ) {
    return undefined
  }

  return `Host "${hostHeader}" is not allowed.`
}

export function validateOriginHeader(
  request: Request,
  allowedOrigins: readonly string[]
): string | undefined {
  const origin = request.headers.get('origin')
  if (origin === null) return undefined
  if (allowedOrigins.includes(origin)) return undefined
  return `Origin "${origin}" is not allowed.`
}

export function corsHeaders(
  request: Request,
  cors: Required<StreamableHttpCorsOptions>
): Headers {
  const headers = new Headers()
  const origin = request.headers.get('origin')
  if (origin === null) return headers

  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set(
    'Access-Control-Allow-Methods',
    'DELETE, GET, OPTIONS, POST'
  )
  headers.set(
    'Access-Control-Allow-Headers',
    cors.allowedHeaders.join(', ')
  )
  headers.set('Access-Control-Max-Age', String(cors.maxAgeSeconds))
  if (cors.allowCredentials) {
    headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return headers
}

export function isLoopbackHost(host: string): boolean {
  return loopbackHosts.has(host)
}

function detectDeploymentMode(): 'development' | 'production' {
  return process.env['NODE_ENV'] === 'production'
    ? 'production'
    : 'development'
}

function normalizeCors(
  options: StreamableHttpOptions['cors']
): false | Required<StreamableHttpCorsOptions> {
  if (options === false || options === undefined) return false
  return {
    allowCredentials: options.allowCredentials ?? false,
    allowedHeaders: freeze(
      options.allowedHeaders ?? [
        'Content-Type',
        'MCP-Protocol-Version',
        'Mcp-Session-Id',
        'Authorization'
      ]
    ),
    maxAgeSeconds: options.maxAgeSeconds ?? 600
  }
}

function normalizePath(path: string): string {
  if (path === '') return '/mcp'
  return path.startsWith('/') ? path : `/${path}`
}

function defaultAllowedHosts(host: string, port: number): readonly string[] {
  if (isLoopbackHost(host)) {
    return freeze([
      '127.0.0.1',
      `127.0.0.1:${port}`,
      'localhost',
      `localhost:${port}`,
      '[::1]',
      `[::1]:${port}`
    ])
  }
  return freeze([host])
}

function normalizeHostValue(host: string): string {
  if (host.startsWith('[')) return host.toLowerCase()
  const separator = host.lastIndexOf(':')
  if (separator === -1) return host.toLowerCase()
  return `${host.slice(0, separator).toLowerCase()}${host.slice(separator)}`
}

function hostNameOnly(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(0, end + 1)
  }
  const separator = host.lastIndexOf(':')
  return separator === -1 ? host : host.slice(0, separator)
}

function freeze<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}
