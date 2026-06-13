import type { AuthContext } from '@mcp-kit/core'

import type { StreamableHttpAuthOptions } from './http-contracts.js'

type JwtSigningAlgorithm = 'RS256' | 'RS384' | 'RS512'

type JwtBearerVerifierOptions = {
  issuer: string | URL
  audience: string | readonly string[]
  jwksUri?: string | URL
  discoveryUrl?: string | URL
  fetch?: typeof fetch
  algorithms?: readonly JwtSigningAlgorithm[]
  clockSkewSeconds?: number
  subjectClaim?: string
  clientIdClaim?: string
  tenantIdClaim?: string
  scopesClaim?: string | readonly string[]
  availableScopesClaim?: string | readonly string[]
  resource?: string | URL
  jwksCacheTtlMs?: number
  consent?: OAuthConsentPort
}

type JwtHeader = {
  alg?: unknown
  kid?: unknown
}

type JwtPayload = Record<string, unknown>

type Jwk = {
  alg?: string
  e?: string
  kid?: string
  kty?: string
  n?: string
  use?: string
}

type JwkSet = {
  keys: readonly Jwk[]
}

type CachedValue<T> = {
  expiresAt: number
  value: T
}

type OAuthConsentRecord = {
  subject: string
  clientId: string
  scopes: readonly string[]
  grantedAt?: number
  expiresAt?: number
}

type OAuthConsentPort = {
  getConsent(input: {
    subject: string
    clientId: string
    scopes: readonly string[]
    resource?: URL
  }): Promise<OAuthConsentRecord | undefined> | OAuthConsentRecord | undefined
}

type OAuthTokenExchangeRequest = {
  clientId?: string
  subject?: string
  scopes: readonly string[]
  audience?: string
  resource?: string | URL
}

type OAuthTokenExchangeResult = {
  accessToken: string
  tokenType?: 'Bearer'
  scopes: readonly string[]
  expiresAt?: number
}

type OAuthTokenExchangePort = {
  exchange(
    input: OAuthTokenExchangeRequest
  ): Promise<OAuthTokenExchangeResult> | OAuthTokenExchangeResult
}

const signatureAlgorithms: Record<
  JwtSigningAlgorithm,
  { name: 'RSASSA-PKCS1-v1_5'; hash: 'SHA-256' | 'SHA-384' | 'SHA-512' }
> = {
  RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  RS384: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
  RS512: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }
}

export type {
  JwtBearerVerifierOptions,
  JwtSigningAlgorithm,
  OAuthConsentPort,
  OAuthConsentRecord,
  OAuthTokenExchangePort,
  OAuthTokenExchangeRequest,
  OAuthTokenExchangeResult
}

export function createJwtBearerVerifier(
  options: JwtBearerVerifierOptions
): StreamableHttpAuthOptions['verifyBearerToken'] {
  const config = normalizeOptions(options)
  const fetchImpl = config.fetch ?? globalThis.fetch
  if (fetchImpl === undefined) {
    throw new Error('JWT bearer verification requires fetch support.')
  }

  let discoveryCache: CachedValue<URL> | undefined
  let discoveryRequest: Promise<URL> | undefined
  let jwksCache: CachedValue<JwkSet> | undefined
  let jwksRequest: Promise<JwkSet> | undefined
  const importedKeys = new Map<string, Promise<CryptoKey>>()

  return async (token) => {
    const jwt = parseJwt(token)
    const algorithm = normalizeAlgorithm(jwt.header.alg, config.algorithms)
    const jwk = await resolveJwk(jwt.header.kid, algorithm)
    const signingInput = new TextEncoder().encode(
      `${jwt.headerSegment}.${jwt.payloadSegment}`
    )
    const signature = decodeBase64Url(jwt.signatureSegment)
    const key = await importVerificationKey(jwk, algorithm)
    const verified = await crypto.subtle.verify(
      signatureAlgorithms[algorithm],
      key,
      toArrayBuffer(signature),
      toArrayBuffer(signingInput)
    )
    if (!verified) {
      throw new Error('JWT signature verification failed.')
    }

    validateClaims(jwt.payload, config)
    return await toAuthContext(jwt.payload, config)
  }

  async function resolveJwk(
    headerKid: unknown,
    algorithm: JwtSigningAlgorithm
  ): Promise<Jwk> {
    const keyId = normalizeKeyId(headerKid)
    const currentSet = await loadJwks(false)
    const currentKey = selectVerificationKey(currentSet.keys, keyId, algorithm)
    if (currentKey !== undefined) {
      return currentKey
    }

    const refreshedSet = await loadJwks(true)
    const refreshedKey = selectVerificationKey(
      refreshedSet.keys,
      keyId,
      algorithm
    )
    if (refreshedKey !== undefined) {
      return refreshedKey
    }

    throw new Error('Signing key not found in JWKS.')
  }

  async function loadJwks(forceRefresh: boolean): Promise<JwkSet> {
    const now = Date.now()
    if (
      forceRefresh !== true &&
      jwksCache !== undefined &&
      jwksCache.expiresAt > now
    ) {
      return jwksCache.value
    }
    if (jwksRequest !== undefined) {
      return jwksRequest
    }

    jwksRequest = (async () => {
      const jwksUri = await resolveJwksUri()
      const jwks = parseJwkSet(
        await fetchJson(fetchImpl, jwksUri, 'JWKS discovery failed.')
      )
      jwksCache = {
        value: jwks,
        expiresAt: Date.now() + config.jwksCacheTtlMs
      }
      return jwks
    })()

    try {
      return await jwksRequest
    } finally {
      jwksRequest = undefined
    }
  }

  async function resolveJwksUri(): Promise<URL> {
    if (config.jwksUri !== undefined) {
      return config.jwksUri
    }

    const now = Date.now()
    if (discoveryCache !== undefined && discoveryCache.expiresAt > now) {
      return discoveryCache.value
    }
    if (discoveryRequest !== undefined) {
      return discoveryRequest
    }

    discoveryRequest = (async () => {
      const document = await fetchJson(
        fetchImpl,
        config.discoveryUrl,
        'OIDC discovery failed.'
      )
      const jwksUri = parseUrlProperty(document, 'jwks_uri')
      discoveryCache = {
        value: jwksUri,
        expiresAt: Date.now() + config.jwksCacheTtlMs
      }
      return jwksUri
    })()

    try {
      return await discoveryRequest
    } finally {
      discoveryRequest = undefined
    }
  }

  function importVerificationKey(
    jwk: Jwk,
    algorithm: JwtSigningAlgorithm
  ): Promise<CryptoKey> {
    const cacheKey = `${algorithm}:${jwk.kid ?? 'default'}:${jwk.n ?? ''}:${jwk.e ?? ''}`
    const cached = importedKeys.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    const key = crypto.subtle.importKey(
      'jwk',
      jwk as never,
      signatureAlgorithms[algorithm],
      false,
      ['verify']
    )
    importedKeys.set(cacheKey, key)
    return key
  }
}

function normalizeOptions(options: JwtBearerVerifierOptions): {
  issuer: string
  audience: readonly string[]
  fetch?: typeof fetch
  algorithms: readonly JwtSigningAlgorithm[]
  clockSkewSeconds: number
  subjectClaim: string
  clientIdClaim: string
  tenantIdClaim: string
  scopesClaim: readonly string[]
  availableScopesClaim: readonly string[]
  jwksUri?: URL
  discoveryUrl: URL
  resource?: URL
  jwksCacheTtlMs: number
  consent?: OAuthConsentPort
} {
  if (options.jwksUri === undefined && options.discoveryUrl === undefined) {
    throw new Error(
      'Provide either jwksUri or discoveryUrl for JWT validation.'
    )
  }

  const issuer = normalizeIssuer(options.issuer)

  return {
    issuer,
    audience: normalizeAudience(options.audience),
    discoveryUrl: normalizeUrl(
      options.discoveryUrl ??
        new URL(
          '.well-known/openid-configuration',
          normalizeUrl(options.issuer)
        )
    ),
    algorithms: [...(options.algorithms ?? ['RS256'])],
    clockSkewSeconds: options.clockSkewSeconds ?? 0,
    subjectClaim: options.subjectClaim ?? 'sub',
    clientIdClaim: options.clientIdClaim ?? 'client_id',
    tenantIdClaim: options.tenantIdClaim ?? 'tenant_id',
    scopesClaim: normalizeScopesClaims(options.scopesClaim),
    availableScopesClaim: normalizeScopesClaims(options.availableScopesClaim),
    jwksCacheTtlMs: options.jwksCacheTtlMs ?? 300_000,
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

function normalizeIssuer(issuer: string | URL): string {
  if (typeof issuer === 'string') {
    normalizeUrl(issuer)
    return issuer
  }
  return issuer.toString()
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
  if (scopesClaim === undefined) {
    return ['scope', 'scp']
  }
  return typeof scopesClaim === 'string' ? [scopesClaim] : [...scopesClaim]
}

function parseJwt(token: string): {
  header: JwtHeader
  payload: JwtPayload
  headerSegment: string
  payloadSegment: string
  signatureSegment: string
} {
  const segments = token.split('.')
  if (segments.length !== 3) {
    throw new Error('JWT must have three segments.')
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments as [
    string,
    string,
    string
  ]
  if (signatureSegment === '') {
    throw new Error('JWT signature segment is missing.')
  }

  return {
    header: parseJsonSegment(headerSegment, 'JWT header') as JwtHeader,
    payload: parseJsonSegment(payloadSegment, 'JWT payload') as JwtPayload,
    headerSegment,
    payloadSegment,
    signatureSegment
  }
}

function parseJsonSegment(segment: string, label: string): unknown {
  const decoded = new TextDecoder().decode(decodeBase64Url(segment))
  const value = JSON.parse(decoded) as unknown
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return value
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4
  const padded =
    padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`
  return Uint8Array.from(Buffer.from(padded, 'base64'))
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.prototype.slice.call(value, 0).buffer
}

function normalizeAlgorithm(
  algorithm: unknown,
  allowed: readonly JwtSigningAlgorithm[]
): JwtSigningAlgorithm {
  if (
    typeof algorithm !== 'string' ||
    !Object.hasOwn(signatureAlgorithms, algorithm)
  ) {
    throw new Error('JWT algorithm is not supported.')
  }
  if (!allowed.includes(algorithm as JwtSigningAlgorithm)) {
    throw new Error('JWT algorithm is not allowed.')
  }
  return algorithm as JwtSigningAlgorithm
}

function normalizeKeyId(keyId: unknown): string | undefined {
  if (keyId === undefined) {
    return undefined
  }
  if (typeof keyId !== 'string' || keyId.trim() === '') {
    throw new Error('JWT key id must be a non-empty string.')
  }
  return keyId
}

function selectVerificationKey(
  keys: readonly Jwk[],
  keyId: string | undefined,
  algorithm: JwtSigningAlgorithm
): Jwk | undefined {
  const candidates = keys.filter((key) => {
    if (key.kty !== 'RSA') return false
    if (key.use !== undefined && key.use !== 'sig') return false
    if (key.alg !== undefined && key.alg !== algorithm) return false
    if (keyId !== undefined) return key.kid === keyId
    return true
  })

  if (keyId === undefined) {
    return candidates.length === 1 ? candidates[0] : undefined
  }
  return candidates[0]
}

function parseJwkSet(value: unknown): JwkSet {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray((value as { keys?: unknown }).keys)
  ) {
    throw new Error('JWKS response must contain a keys array.')
  }
  return { keys: (value as { keys: readonly Jwk[] }).keys }
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
  failureMessage: string
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(`${failureMessage} HTTP ${response.status}.`)
  }
  return await response.json()
}

function parseUrlProperty(value: unknown, key: string): URL {
  if (value === null || typeof value !== 'object') {
    throw new Error(`Discovery response must contain ${key}.`)
  }
  const candidate = (value as Record<string, unknown>)[key]
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error(`Discovery response must contain ${key}.`)
  }
  return new URL(candidate)
}

function validateClaims(
  payload: JwtPayload,
  config: ReturnType<typeof normalizeOptions>
): void {
  const issuer = readStringClaim(payload, 'iss')
  if (issuer !== config.issuer) {
    throw new Error('JWT issuer does not match the configured issuer.')
  }

  const audiences = readAudienceClaim(payload)
  if (!audiences.some((audience) => config.audience.includes(audience))) {
    throw new Error('JWT audience does not match the configured audience.')
  }

  const nowSeconds = Date.now() / 1000
  const exp = readNumericClaim(payload, 'exp')
  if (exp <= nowSeconds - config.clockSkewSeconds) {
    throw new Error('JWT has expired.')
  }

  const notBefore = optionalNumericClaim(payload, 'nbf')
  if (
    notBefore !== undefined &&
    notBefore > nowSeconds + config.clockSkewSeconds
  ) {
    throw new Error('JWT is not active yet.')
  }
}

function readStringClaim(payload: JwtPayload, claim: string): string {
  const value = payload[claim]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`JWT claim "${claim}" must be a non-empty string.`)
  }
  return value
}

function readAudienceClaim(payload: JwtPayload): readonly string[] {
  const value = payload['aud']
  if (typeof value === 'string' && value.trim() !== '') {
    return [value]
  }
  if (Array.isArray(value) && value.every(isNonEmptyString)) {
    return value
  }
  throw new Error('JWT claim "aud" must be a string or string array.')
}

function readNumericClaim(payload: JwtPayload, claim: string): number {
  const value = optionalNumericClaim(payload, claim)
  if (value === undefined) {
    throw new Error(`JWT claim "${claim}" must be a number.`)
  }
  return value
}

function optionalNumericClaim(
  payload: JwtPayload,
  claim: string
): number | undefined {
  const value = payload[claim]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || Number.isFinite(value) !== true) {
    throw new Error(`JWT claim "${claim}" must be a number.`)
  }
  return value
}

async function toAuthContext(
  payload: JwtPayload,
  config: ReturnType<typeof normalizeOptions>
): Promise<AuthContext> {
  const subject = optionalStringClaim(payload, config.subjectClaim)
  const clientId = optionalStringClaim(payload, config.clientIdClaim)
  const tenantId = optionalStringClaim(payload, config.tenantIdClaim)
  const scopes = readScopes(payload, config.scopesClaim)
  const availableScopes = readScopes(payload, config.availableScopesClaim)
  const consent = await loadConsent(config, subject, clientId, scopes)

  return {
    source: 'oauth',
    scopes,
    expiresAt: readNumericClaim(payload, 'exp') * 1000,
    extra: {},
    ...(subject === undefined ? {} : { subject }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(config.resource === undefined ? {} : { resource: config.resource }),
    ...(availableScopes.length === 0 && consent === undefined
      ? {}
      : {
          authorization: {
            ...(availableScopes.length === 0 ? {} : { availableScopes }),
            ...(consent === undefined ? {} : { consent })
          }
        })
  }
}

function optionalStringClaim(
  payload: JwtPayload,
  claim: string
): string | undefined {
  const value = payload[claim]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`JWT claim "${claim}" must be a non-empty string.`)
  }
  return value
}

function readScopes(
  payload: JwtPayload,
  scopeClaims: readonly string[]
): readonly string[] {
  for (const claim of scopeClaims) {
    const value = payload[claim]
    if (value === undefined) {
      continue
    }
    if (typeof value === 'string') {
      return value
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter((scope) => scope !== '')
    }
    if (Array.isArray(value) && value.every(isNonEmptyString)) {
      return value
    }
    throw new Error(`JWT claim "${claim}" must be a string or string array.`)
  }

  return []
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

async function loadConsent(
  config: ReturnType<typeof normalizeOptions>,
  subject: string | undefined,
  clientId: string | undefined,
  scopes: readonly string[]
): Promise<OAuthConsentRecord | undefined> {
  if (
    config.consent === undefined ||
    subject === undefined ||
    clientId === undefined
  ) {
    return undefined
  }

  return await config.consent.getConsent({
    subject,
    clientId,
    scopes,
    ...(config.resource === undefined ? {} : { resource: config.resource })
  })
}

export async function exchangeDownstreamAccessToken(
  port: OAuthTokenExchangePort,
  auth: Pick<AuthContext, 'clientId' | 'resource' | 'subject'>,
  request: OAuthTokenExchangeRequest
): Promise<OAuthTokenExchangeResult> {
  return await port.exchange({
    ...request,
    ...(request.clientId === undefined && auth.clientId !== undefined
      ? { clientId: auth.clientId }
      : {}),
    ...(request.subject === undefined && auth.subject !== undefined
      ? { subject: auth.subject }
      : {}),
    ...(request.resource === undefined && auth.resource !== undefined
      ? { resource: auth.resource }
      : {})
  })
}
