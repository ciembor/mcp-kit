import type { AuthContext } from '@mcp-kit/core'

import type { StreamableHttpAuthOptions } from './http-contracts.js'
import {
  normalizeAlgorithm,
  normalizeOptions,
  parseJwt
} from './oauth-jwt-internals.js'
import { createJwkResolver, verifyJwtSignature } from './oauth-jwt-jwks.js'
import { toAuthContext, validateClaims } from './oauth-jwt-claims.js'

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

export type JwtHeader = {
  alg?: unknown
  kid?: unknown
}

export type JwtPayload = Record<string, unknown>

export type Jwk = {
  alg?: string
  e?: string
  kid?: string
  kty?: string
  n?: string
  use?: string
}

export type JwkSet = {
  keys: readonly Jwk[]
}

export type OAuthConsentRecord = {
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

export type {
  JwtBearerVerifierOptions,
  JwtSigningAlgorithm,
  OAuthConsentPort,
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
  const jwks = createJwkResolver(config, fetchImpl)

  return async (token) => {
    const jwt = parseJwt(token)
    const algorithm = normalizeAlgorithm(jwt.header.alg, config.algorithms)
    const verified = await verifyJwtSignature({
      jwt,
      algorithm,
      jwk: await jwks.resolve(jwt.header.kid, algorithm),
      importKey: (jwk, signingAlgorithm) =>
        jwks.importKey(jwk, signingAlgorithm)
    })
    if (!verified) {
      throw new Error('JWT signature verification failed.')
    }

    validateClaims(jwt.payload, config)
    return toAuthContext(jwt.payload, config)
  }
}

export type NormalizedJwtBearerVerifierOptions = {
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
