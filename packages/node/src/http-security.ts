import type {
  NormalizedStreamableHttpOptions,
  StreamableHttpCorsOptions,
  StreamableHttpOptions
} from './http-contracts.js'
import { createInMemorySessionStore } from './session-store.js'

const loopbackHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

export function normalizeStreamableHttpOptions(
  options: StreamableHttpOptions = {}
): NormalizedStreamableHttpOptions {
  const normalized = normalizedOptionInputs(options)
  assertNormalizedPolicies(options.mode, normalized)
  return buildNormalizedOptions(options, normalized)
}

export function validateHostHeader(
  request: Request,
  allowedHosts: readonly string[]
): string | undefined {
  const hostHeader = request.headers.get('host')
  if (hostHeader === null) return 'Missing Host header.'

  const normalized = normalizeHostValue(hostHeader)
  if (
    allowedHosts.some((allowedHost) => hostMatches(normalized, allowedHost))
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
  headers.set('Access-Control-Allow-Methods', 'DELETE, GET, OPTIONS, POST')
  headers.set('Access-Control-Allow-Headers', cors.allowedHeaders.join(', '))
  headers.set('Access-Control-Expose-Headers', 'X-Correlation-Id')
  headers.set('Access-Control-Max-Age', String(cors.maxAgeSeconds))
  if (cors.allowCredentials) {
    headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return headers
}

function isLoopbackHost(host: string): boolean {
  return loopbackHosts.has(host)
}

function detectDeploymentMode(): 'development' | 'production' {
  return process.env['NODE_ENV'] === 'production' ? 'production' : 'development'
}

function normalizedOptionInputs(options: StreamableHttpOptions) {
  const mode = options.mode ?? detectDeploymentMode()
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3000
  const trustedProxies = freeze(options.trustedProxies ?? [])
  const auth = options.auth
  const allowedOrigins = freeze(options.allowedOrigins ?? [])
  const cors = normalizeCors(options.cors)
  const sessionMode = options.sessionMode ?? 'stateless'

  return {
    mode,
    host,
    port,
    trustedProxies,
    auth,
    allowedOrigins,
    cors,
    sessionMode,
    sessionStore: resolveSessionStore(options, sessionMode, mode)
  }
}

function assertNormalizedPolicies(
  explicitMode: StreamableHttpOptions['mode'],
  normalized: ReturnType<typeof normalizedOptionInputs>
): void {
  assertBindingPolicy(explicitMode, normalized.host, normalized.trustedProxies)
  assertPublicAuthPolicy(normalized.mode, normalized.host, normalized.auth)
  assertCorsPolicy(normalized.cors, normalized.allowedOrigins)
}

function buildNormalizedOptions(
  options: StreamableHttpOptions,
  normalized: ReturnType<typeof normalizedOptionInputs>
): NormalizedStreamableHttpOptions {
  return {
    mode: normalized.mode,
    host: normalized.host,
    port: normalized.port,
    path: normalizePath(options.path ?? '/mcp'),
    healthPath: normalizeOptionalPath(options.healthPath, '/healthz'),
    readinessPath: normalizeOptionalPath(options.readinessPath, '/readyz'),
    sessionMode: normalized.sessionMode,
    ...optionalSessionStore(normalized.sessionStore),
    ...optionalEventStore(options),
    ...optionalRetryInterval(options),
    ...optionalAuth(normalized.auth),
    trustedProxies: normalized.trustedProxies,
    allowedHosts: freeze(
      options.allowedHosts ??
        defaultAllowedHosts(normalized.host, normalized.port)
    ),
    allowedOrigins: normalized.allowedOrigins,
    cors: normalized.cors,
    maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
    requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
    maxConcurrency: options.maxConcurrency ?? 16,
    ...(options.observability === undefined
      ? {}
      : { observability: options.observability })
  }
}

function resolveSessionStore(
  options: StreamableHttpOptions,
  sessionMode: 'stateless' | 'stateful',
  mode: 'development' | 'production'
) {
  if (sessionMode !== 'stateful') return undefined
  if (mode === 'production') {
    throw new Error(
      'Stateful Streamable HTTP is single-process only and is not supported in production.'
    )
  }
  return options.sessionStore ?? defaultSessionStore(mode)
}

function assertBindingPolicy(
  explicitMode: StreamableHttpOptions['mode'],
  host: string,
  trustedProxies: readonly string[]
): void {
  if (host !== '0.0.0.0') return
  if (explicitMode === undefined) {
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

function assertPublicAuthPolicy(
  mode: 'development' | 'production',
  host: string,
  auth: StreamableHttpOptions['auth']
): void {
  if (mode !== 'production' || isLoopbackHost(host) || auth !== undefined)
    return
  throw new Error(
    'Public production Streamable HTTP requires an explicit auth decision.'
  )
}

function assertCorsPolicy(
  cors: false | Required<StreamableHttpCorsOptions>,
  allowedOrigins: readonly string[]
): void {
  if (cors === false || allowedOrigins.length > 0) return
  throw new Error(
    'CORS requires explicit allowedOrigins; wildcard browser access is not enabled by default.'
  )
}

function optionalSessionStore(
  sessionStore: NormalizedStreamableHttpOptions['sessionStore']
) {
  return sessionStore === undefined ? {} : { sessionStore }
}

function optionalEventStore(options: StreamableHttpOptions) {
  return options.eventStore === undefined
    ? {}
    : { eventStore: options.eventStore }
}

function optionalRetryInterval(options: StreamableHttpOptions) {
  return options.retryIntervalMs === undefined
    ? {}
    : { retryIntervalMs: options.retryIntervalMs }
}

function optionalAuth(auth: StreamableHttpOptions['auth']) {
  return auth === undefined ? {} : { auth }
}

function defaultSessionStore(mode: 'development' | 'production') {
  if (mode === 'development') {
    return createInMemorySessionStore()
  }
  throw new Error(
    'Stateful Streamable HTTP is single-process only and is not supported in production.'
  )
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
        'Last-Event-ID',
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

function normalizeOptionalPath(
  path: string | false | undefined,
  fallback: string
): string | false {
  if (path === false) return false
  return normalizePath(path ?? fallback)
}

function defaultAllowedHosts(host: string, port: number): readonly string[] {
  if (isLoopbackHost(host)) {
    return freeze([
      '127.0.0.1',
      `127.0.0.1:${port}`,
      '127.0.0.1:*',
      'localhost',
      `localhost:${port}`,
      'localhost:*',
      '[::1]',
      `[::1]:${port}`,
      '[::1]:*'
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

function hostMatches(host: string, allowedHost: string): boolean {
  const normalizedAllowed = normalizeHostValue(allowedHost)
  if (normalizedAllowed.endsWith(':*')) {
    return hostNameOnly(host) === hostNameOnly(normalizedAllowed.slice(0, -2))
  }
  return normalizedAllowed === host
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
