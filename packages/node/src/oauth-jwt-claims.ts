import type { AuthContext } from '@mcp-kit/core'

import type {
  JwtPayload,
  NormalizedJwtBearerVerifierOptions,
  OAuthConsentRecord
} from './oauth-jwt.js'

export function validateClaims(
  payload: JwtPayload,
  config: NormalizedJwtBearerVerifierOptions
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

export async function toAuthContext(
  payload: JwtPayload,
  config: NormalizedJwtBearerVerifierOptions
): Promise<AuthContext> {
  const subject = optionalStringClaim(payload, config.subjectClaim)
  const clientId = optionalStringClaim(payload, config.clientIdClaim)
  const tenantId = optionalStringClaim(payload, config.tenantIdClaim)
  const scopes = readScopes(payload, config.scopesClaim)
  const availableScopes = readScopes(payload, config.availableScopesClaim)
  const consent = await loadConsent(config, subject, clientId, scopes)
  const authorization = authorizationDetails(availableScopes, consent)
  return {
    source: 'oauth',
    scopes,
    expiresAt: readNumericClaim(payload, 'exp') * 1000,
    extra: {},
    ...(subject === undefined ? {} : { subject }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(config.resource === undefined ? {} : { resource: config.resource }),
    ...(authorization === undefined ? {} : { authorization })
  }
}

function readStringClaim(payload: JwtPayload, claim: string): string {
  const value = payload[claim]
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`JWT claim "${claim}" must be a non-empty string.`)
}

function readAudienceClaim(payload: JwtPayload): readonly string[] {
  const value = payload['aud']
  if (typeof value === 'string' && value.trim() !== '') return [value]
  if (Array.isArray(value) && value.every(isNonEmptyString)) return value
  throw new Error('JWT claim "aud" must be a string or string array.')
}

function readNumericClaim(payload: JwtPayload, claim: string): number {
  const value = optionalNumericClaim(payload, claim)
  if (value !== undefined) return value
  throw new Error(`JWT claim "${claim}" must be a number.`)
}

function optionalNumericClaim(
  payload: JwtPayload,
  claim: string
): number | undefined {
  const value = payload[claim]
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`JWT claim "${claim}" must be a number.`)
}

function optionalStringClaim(
  payload: JwtPayload,
  claim: string
): string | undefined {
  const value = payload[claim]
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`JWT claim "${claim}" must be a non-empty string.`)
}

function readScopes(
  payload: JwtPayload,
  scopeClaims: readonly string[]
): readonly string[] {
  for (const claim of scopeClaims) {
    const value = payload[claim]
    if (value === undefined) continue
    if (typeof value === 'string') {
      return value
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter((scope) => scope !== '')
    }
    if (Array.isArray(value) && value.every(isNonEmptyString)) return value
    throw new Error(`JWT claim "${claim}" must be a string or string array.`)
  }
  return []
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

async function loadConsent(
  config: NormalizedJwtBearerVerifierOptions,
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
  return config.consent.getConsent({
    subject,
    clientId,
    scopes,
    ...(config.resource === undefined ? {} : { resource: config.resource })
  })
}

function authorizationDetails(
  availableScopes: readonly string[],
  consent: OAuthConsentRecord | undefined
): AuthContext['authorization'] | undefined {
  if (availableScopes.length === 0 && consent === undefined) return undefined
  return {
    ...(availableScopes.length === 0 ? {} : { availableScopes }),
    ...(consent === undefined ? {} : { consent })
  }
}
