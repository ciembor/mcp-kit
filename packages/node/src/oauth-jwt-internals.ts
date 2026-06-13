import type {
  JwtBearerVerifierOptions,
  JwtHeader,
  JwtPayload,
  JwtSigningAlgorithm,
  NormalizedJwtBearerVerifierOptions
} from './oauth-jwt.js'

const supportedAlgorithms = new Set(['RS256', 'RS384', 'RS512'])

export function normalizeOptions(
  options: JwtBearerVerifierOptions
): NormalizedJwtBearerVerifierOptions {
  assertJwksSource(options)
  return {
    issuer: normalizeIssuer(options.issuer),
    audience: normalizeAudience(options.audience),
    discoveryUrl: normalizeDiscoveryUrl(options),
    algorithms: [...(options.algorithms ?? ['RS256'])],
    clockSkewSeconds: options.clockSkewSeconds ?? 0,
    subjectClaim: options.subjectClaim ?? 'sub',
    clientIdClaim: options.clientIdClaim ?? 'client_id',
    tenantIdClaim: options.tenantIdClaim ?? 'tenant_id',
    scopesClaim: normalizeScopesClaims(options.scopesClaim),
    availableScopesClaim: normalizeScopesClaims(options.availableScopesClaim),
    jwksCacheTtlMs: options.jwksCacheTtlMs ?? 300_000,
    ...optionalNormalizedOptions(options)
  }
}

export function parseJwt(token: string): {
  header: JwtHeader
  payload: JwtPayload
  headerSegment: string
  payloadSegment: string
  signatureSegment: string
} {
  const [headerSegment, payloadSegment, signatureSegment] =
    parseJwtSegments(token)
  return {
    header: parseJsonSegment(headerSegment, 'JWT header') as JwtHeader,
    payload: parseJsonSegment(payloadSegment, 'JWT payload') as JwtPayload,
    headerSegment,
    payloadSegment,
    signatureSegment
  }
}

export function normalizeAlgorithm(
  algorithm: unknown,
  allowed: readonly JwtSigningAlgorithm[]
): JwtSigningAlgorithm {
  if (typeof algorithm !== 'string' || !supportedAlgorithms.has(algorithm)) {
    throw new Error('JWT algorithm is not supported.')
  }
  if (allowed.includes(algorithm as JwtSigningAlgorithm)) {
    return algorithm as JwtSigningAlgorithm
  }
  throw new Error('JWT algorithm is not allowed.')
}

function assertJwksSource(options: JwtBearerVerifierOptions): void {
  if (options.jwksUri !== undefined || options.discoveryUrl !== undefined) {
    return
  }
  throw new Error('Provide either jwksUri or discoveryUrl for JWT validation.')
}

function normalizeIssuer(issuer: string | URL): string {
  if (typeof issuer === 'string') {
    normalizeUrl(issuer)
    return issuer
  }
  return issuer.toString()
}

function normalizeDiscoveryUrl(options: JwtBearerVerifierOptions): URL {
  return normalizeUrl(
    options.discoveryUrl ??
      new URL('.well-known/openid-configuration', normalizeUrl(options.issuer))
  )
}

function normalizeUrl(value: string | URL): URL {
  return value instanceof URL ? new URL(value.toString()) : new URL(value)
}

function normalizeAudience(
  audience: string | readonly string[]
): readonly string[] {
  const values = typeof audience === 'string' ? [audience] : audience
  if (values.length === 0 || values.some((value) => value.trim() === '')) {
    throw new Error('JWT audience must contain at least one value.')
  }
  return [...values]
}

function normalizeScopesClaims(
  scopesClaim: string | readonly string[] | undefined
): readonly string[] {
  if (scopesClaim === undefined) return ['scope', 'scp']
  return typeof scopesClaim === 'string' ? [scopesClaim] : [...scopesClaim]
}

function optionalNormalizedOptions(
  options: JwtBearerVerifierOptions
): Pick<
  NormalizedJwtBearerVerifierOptions,
  'fetch' | 'jwksUri' | 'resource' | 'consent'
> {
  return {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.jwksUri === undefined
      ? {}
      : { jwksUri: normalizeUrl(options.jwksUri) }),
    ...(options.resource === undefined
      ? {}
      : { resource: normalizeUrl(options.resource) }),
    ...(options.consent === undefined ? {} : { consent: options.consent })
  }
}

function parseJwtSegments(token: string): [string, string, string] {
  const segments = token.split('.')
  if (segments.length !== 3) {
    throw new Error('JWT must have three segments.')
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments as [
    string,
    string,
    string
  ]
  if (signatureSegment !== '') {
    return [headerSegment, payloadSegment, signatureSegment]
  }
  throw new Error('JWT signature segment is missing.')
}

function parseJsonSegment(segment: string, label: string): unknown {
  const decoded = new TextDecoder().decode(decodeBase64Url(segment))
  const value = JSON.parse(decoded) as unknown
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  throw new Error(`${label} must be a JSON object.`)
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4
  const padded =
    padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`
  return Uint8Array.from(Buffer.from(padded, 'base64'))
}
