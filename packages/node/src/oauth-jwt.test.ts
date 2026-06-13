import { generateKeyPairSync, sign as signBuffer } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createJwtBearerVerifier } from './oauth-jwt.js'

describe('createJwtBearerVerifier', () => {
  it('verifies RSA bearer tokens against a JWKS endpoint', async () => {
    const key = createRsaKeyPair('primary')
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ keys: [key.publicJwk] }))
    )
    const verifyBearerToken = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      resource: 'https://resource.example/mcp',
      fetch
    })
    const token = signJwt(
      {
        iss: 'https://issuer.example',
        aud: 'mcp-kit',
        exp: futureEpochSeconds(),
        sub: 'alice',
        client_id: 'client-1',
        tenant_id: 'tenant-a',
        scope: 'tools:read tools:write'
      },
      key
    )

    const result = await verifyBearerToken(
      token,
      new Request('https://resource.example/mcp')
    )

    expect(result).toMatchObject({
      source: 'oauth',
      subject: 'alice',
      clientId: 'client-1',
      tenantId: 'tenant-a',
      scopes: ['tools:read', 'tools:write'],
      resource: new URL('https://resource.example/mcp'),
      extra: {}
    })
    expect(result.expiresAt).toBeTypeOf('number')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(new URL('https://issuer.example/jwks'), {
      headers: { accept: 'application/json' }
    })
  })

  it('uses discovery when jwksUri is not provided and refreshes the JWKS on unknown kid', async () => {
    const oldKey = createRsaKeyPair('old')
    const currentKey = createRsaKeyPair('current')
    const fetchMock: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jwks_uri: 'https://issuer.example/.well-known/jwks' })
      )
      .mockResolvedValueOnce(jsonResponse({ keys: [oldKey.publicJwk] }))
      .mockResolvedValueOnce(jsonResponse({ keys: [currentKey.publicJwk] }))
    const verifyBearerToken = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: ['mcp-kit', 'other-audience'],
      discoveryUrl: 'https://issuer.example/.well-known/openid-configuration',
      fetch: fetchMock
    })
    const token = signJwt(
      {
        iss: 'https://issuer.example',
        aud: ['other-audience'],
        exp: futureEpochSeconds(),
        sub: 'service-user',
        scp: ['tools:read']
      },
      currentKey
    )

    await expect(
      verifyBearerToken(token, new Request('https://resource.example/mcp'))
    ).resolves.toMatchObject({
      source: 'oauth',
      subject: 'service-user',
      scopes: ['tools:read']
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reuses cached JWKS entries across successful verifications', async () => {
    const key = createRsaKeyPair('cached')
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ keys: [key.publicJwk] }))
    )
    const verifyBearerToken = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch
    })
    const first = signJwt(
      {
        iss: 'https://issuer.example',
        aud: 'mcp-kit',
        exp: futureEpochSeconds(),
        sub: 'alice'
      },
      key
    )
    const second = signJwt(
      {
        iss: 'https://issuer.example',
        aud: 'mcp-kit',
        exp: futureEpochSeconds(),
        sub: 'bob'
      },
      key
    )

    await verifyBearerToken(first, new Request('https://resource.example/mcp'))
    await verifyBearerToken(second, new Request('https://resource.example/mcp'))

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported algorithms and malformed key ids before looking up keys', async () => {
    const key = createRsaKeyPair('alg')
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ keys: [key.publicJwk] }))
    )
    const verifyBearerToken = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch
    })

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds()
          },
          key,
          { alg: 'HS256' }
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT algorithm is not supported.')

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds()
          },
          key,
          { kid: '   ' }
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT key id must be a non-empty string.')
  })

  it('rejects issuer, audience, expiry, nbf, and signature failures', async () => {
    const key = createRsaKeyPair('claims')
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ keys: [key.publicJwk] }))
    )
    const verifyBearerToken = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch
    })

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://other-issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds()
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT issuer does not match the configured issuer.')

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'other-audience',
            exp: futureEpochSeconds()
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT audience does not match the configured audience.')

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: pastEpochSeconds()
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT has expired.')

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds(),
            nbf: futureEpochSeconds(300)
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT is not active yet.')

    const tampered = signJwt(
      {
        iss: 'https://issuer.example',
        aud: 'mcp-kit',
        exp: futureEpochSeconds()
      },
      key
    )
      .split('.')
      .map((segment, index) =>
        index === 2 ? `${segment.slice(0, -2)}xx` : segment
      )
      .join('.')

    await expect(
      verifyBearerToken(tampered, new Request('https://resource.example/mcp'))
    ).rejects.toThrow('JWT signature verification failed.')
  })

  it('rejects malformed claims, malformed tokens, ambiguous key sets, and bad fetch responses', async () => {
    const key = createRsaKeyPair('errors')
    const verifyBearerToken = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() =>
        Promise.resolve(jsonResponse({ keys: [key.publicJwk] }))
      )
    })
    const ambiguousKeys = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() =>
        Promise.resolve(jsonResponse({ keys: [key.publicJwk, key.publicJwk] }))
      )
    })

    await expect(
      verifyBearerToken(
        'not-a-jwt',
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT must have three segments.')

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit'
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT claim "exp" must be a number.')

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: ['mcp-kit', ''],
            exp: futureEpochSeconds()
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT claim "aud" must be a string or string array.')

    await expect(
      verifyBearerToken(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds(),
            scope: [1, 2]
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWT claim "scope" must be a string or string array.')

    await expect(
      ambiguousKeys(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds()
          },
          key,
          { kid: undefined }
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('Signing key not found in JWKS.')

    const invalidDiscovery = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      discoveryUrl: 'https://issuer.example/.well-known/openid-configuration',
      fetch: vi.fn(() =>
        Promise.resolve(jsonResponse({ issuer: 'https://issuer.example' }))
      )
    })

    await expect(
      invalidDiscovery(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds()
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('Discovery response must contain jwks_uri.')

    const failingFetch = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() => Promise.resolve(new Response('nope', { status: 503 })))
    })

    await expect(
      failingFetch(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: futureEpochSeconds()
          },
          key
        ),
        new Request('https://resource.example/mcp')
      )
    ).rejects.toThrow('JWKS discovery failed. HTTP 503.')
  })

  it('validates constructor options up front', () => {
    expect(() =>
      createJwtBearerVerifier({
        issuer: 'https://issuer.example',
        audience: [],
        jwksUri: 'https://issuer.example/jwks'
      })
    ).toThrow('JWT audience must contain at least one value.')

    expect(() =>
      createJwtBearerVerifier({
        issuer: 'https://issuer.example',
        audience: 'mcp-kit'
      })
    ).toThrow('Provide either jwksUri or discoveryUrl for JWT validation.')
  })
})

function createRsaKeyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  })
  const publicJwk = publicKey.export({
    format: 'jwk'
  }) as {
    alg?: string
    kid?: string
    use?: string
  }
  publicJwk.kid = kid
  publicJwk.use = 'sig'
  publicJwk.alg = 'RS256'

  return {
    kid,
    privateKey,
    publicJwk
  }
}

function signJwt(
  payload: Record<string, unknown>,
  key: ReturnType<typeof createRsaKeyPair>,
  headerOverrides?: { alg?: string; kid?: string | undefined }
): string {
  const includeKid =
    headerOverrides === undefined || 'kid' in headerOverrides === false
  const header = {
    alg: headerOverrides?.alg ?? 'RS256',
    typ: 'JWT',
    ...(includeKid ? { kid: key.kid } : { kid: headerOverrides.kid })
  }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = signBuffer(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    key.privateKey
  )

  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function futureEpochSeconds(offsetSeconds = 3_600): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds
}

function pastEpochSeconds(): number {
  return Math.floor(Date.now() / 1000) - 60
}
