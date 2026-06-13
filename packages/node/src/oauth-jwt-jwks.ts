import type {
  Jwk,
  JwkSet,
  JwtSigningAlgorithm,
  NormalizedJwtBearerVerifierOptions
} from './oauth-jwt.js'

const signatureAlgorithms: Record<
  JwtSigningAlgorithm,
  { name: 'RSASSA-PKCS1-v1_5'; hash: 'SHA-256' | 'SHA-384' | 'SHA-512' }
> = {
  RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  RS384: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
  RS512: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }
}

export function createJwkResolver(
  config: NormalizedJwtBearerVerifierOptions,
  fetchImpl: typeof fetch
): {
  resolve(headerKid: unknown, algorithm: JwtSigningAlgorithm): Promise<Jwk>
  importKey(jwk: Jwk, algorithm: JwtSigningAlgorithm): Promise<CryptoKey>
} {
  const cache = createJwkCache(config, fetchImpl)
  return {
    async resolve(headerKid, algorithm) {
      const keyId = normalizeKeyId(headerKid)
      return (
        selectVerificationKey(
          (await cache.load(false)).keys,
          keyId,
          algorithm
        ) ??
        selectVerificationKey(
          (await cache.load(true)).keys,
          keyId,
          algorithm
        ) ??
        missingSigningKey()
      )
    },
    importKey(jwk, algorithm) {
      return cache.importKey(jwk, algorithm)
    }
  }
}

export async function verifyJwtSignature(args: {
  jwt: {
    headerSegment: string
    payloadSegment: string
    signatureSegment: string
  }
  algorithm: JwtSigningAlgorithm
  jwk: Jwk
  importKey(jwk: Jwk, algorithm: JwtSigningAlgorithm): Promise<CryptoKey>
}): Promise<boolean> {
  const signingInput = new TextEncoder().encode(
    `${args.jwt.headerSegment}.${args.jwt.payloadSegment}`
  )
  const signature = decodeBase64Url(args.jwt.signatureSegment)
  const key = await args.importKey(args.jwk, args.algorithm)
  return crypto.subtle.verify(
    signatureAlgorithms[args.algorithm],
    key,
    toArrayBuffer(signature),
    toArrayBuffer(signingInput)
  )
}

type CachedValue<T> = {
  expiresAt: number
  value: T
}

function createJwkCache(
  config: NormalizedJwtBearerVerifierOptions,
  fetchImpl: typeof fetch
): {
  load(forceRefresh: boolean): Promise<JwkSet>
  importKey(jwk: Jwk, algorithm: JwtSigningAlgorithm): Promise<CryptoKey>
} {
  let discoveryCache: CachedValue<URL> | undefined
  let jwksCache: CachedValue<JwkSet> | undefined
  let jwksRequest: Promise<JwkSet> | undefined
  const importedKeys = new Map<string, Promise<CryptoKey>>()
  const discovery = {
    get cache() {
      return discoveryCache
    },
    update(cache: CachedValue<URL> | undefined) {
      discoveryCache = cache
    }
  }

  return {
    load: (forceRefresh) =>
      loadJwkSet(forceRefresh, {
        config,
        fetchImpl,
        discovery,
        currentCache: jwksCache,
        currentRequest: jwksRequest,
        updateCache(value) {
          jwksCache = value
        },
        updateRequest(value) {
          jwksRequest = value
        }
      }),
    importKey: (jwk, algorithm) =>
      importVerificationKey(importedKeys, jwk, algorithm)
  }
}

async function loadJwkSet(
  forceRefresh: boolean,
  state: {
    config: NormalizedJwtBearerVerifierOptions
    fetchImpl: typeof fetch
    discovery: {
      cache: CachedValue<URL> | undefined
      update(cache: CachedValue<URL> | undefined): void
    }
    currentCache: CachedValue<JwkSet> | undefined
    currentRequest: Promise<JwkSet> | undefined
    updateCache(value: CachedValue<JwkSet> | undefined): void
    updateRequest(value: Promise<JwkSet> | undefined): void
  }
): Promise<JwkSet> {
  const now = Date.now()
  if (
    forceRefresh !== true &&
    state.currentCache !== undefined &&
    state.currentCache.expiresAt > now
  ) {
    return state.currentCache.value
  }
  if (state.currentRequest !== undefined) return state.currentRequest

  const request = (async () => {
    const jwks = parseJwkSet(
      await fetchJson(
        state.fetchImpl,
        await resolveJwksUri(state.config, state.fetchImpl, state.discovery),
        'JWKS discovery failed.'
      )
    )
    state.updateCache({
      value: jwks,
      expiresAt: Date.now() + state.config.jwksCacheTtlMs
    })
    return jwks
  })()
  state.updateRequest(request)

  try {
    return await request
  } finally {
    state.updateRequest(undefined)
  }
}

function importVerificationKey(
  importedKeys: Map<string, Promise<CryptoKey>>,
  jwk: Jwk,
  algorithm: JwtSigningAlgorithm
): Promise<CryptoKey> {
  const cacheKey = `${algorithm}:${jwk.kid ?? 'default'}:${jwk.n ?? ''}:${jwk.e ?? ''}`
  const cached = importedKeys.get(cacheKey)
  if (cached !== undefined) return cached

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

async function resolveJwksUri(
  config: NormalizedJwtBearerVerifierOptions,
  fetchImpl: typeof fetch,
  discovery: {
    cache: CachedValue<URL> | undefined
    update(cache: CachedValue<URL> | undefined): void
  }
): Promise<URL> {
  if (config.jwksUri !== undefined) return config.jwksUri

  const now = Date.now()
  if (discovery.cache !== undefined && discovery.cache.expiresAt > now) {
    return discovery.cache.value
  }

  const request = (async () => {
    const jwksUri = parseUrlProperty(
      await fetchJson(fetchImpl, config.discoveryUrl, 'OIDC discovery failed.'),
      'jwks_uri'
    )
    discovery.update({
      value: jwksUri,
      expiresAt: Date.now() + config.jwksCacheTtlMs
    })
    return jwksUri
  })()

  try {
    return await request
  } finally {
    discovery.update(discovery.cache)
  }
}

function normalizeKeyId(keyId: unknown): string | undefined {
  if (keyId === undefined) return undefined
  if (typeof keyId === 'string' && keyId.trim() !== '') return keyId
  throw new Error('JWT key id must be a non-empty string.')
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
    return keyId === undefined ? true : key.kid === keyId
  })
  if (keyId !== undefined) return candidates[0]
  return candidates.length === 1 ? candidates[0] : undefined
}

function missingSigningKey(): never {
  throw new Error('Signing key not found in JWKS.')
}

function parseJwkSet(value: unknown): JwkSet {
  if (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { keys?: unknown }).keys)
  ) {
    return { keys: (value as { keys: readonly Jwk[] }).keys }
  }
  throw new Error('JWKS response must contain a keys array.')
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
  failureMessage: string
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' }
  })
  if (response.ok) return response.json()
  throw new Error(`${failureMessage} HTTP ${response.status}.`)
}

function parseUrlProperty(value: unknown, key: string): URL {
  if (value !== null && typeof value === 'object') {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return new URL(candidate)
    }
  }
  throw new Error(`Discovery response must contain ${key}.`)
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
