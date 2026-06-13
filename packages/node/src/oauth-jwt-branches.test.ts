import { generateKeyPairSync, sign as signBuffer } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  createJwtBearerVerifier,
  exchangeDownstreamAccessToken
} from './oauth-jwt.js'
import {
  normalizeAlgorithm,
  normalizeOptions,
  parseJwt
} from './oauth-jwt-internals.js'

describe('oauth jwt branch coverage', () => {
  it('requires fetch support when neither options.fetch nor global fetch is available', () => {
    const originalFetch = globalThis.fetch
    // @ts-expect-error test override
    globalThis.fetch = undefined
    try {
      expect(() =>
        createJwtBearerVerifier({
          issuer: 'https://issuer.example',
          audience: 'mcp-kit',
          jwksUri: 'https://issuer.example/jwks'
        })
      ).toThrow('JWT bearer verification requires fetch support.')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('normalizes options, validates algorithms and rejects malformed JWT parsing inputs', () => {
    expect(
      normalizeOptions({
        issuer: new URL('https://issuer.example'),
        audience: 'mcp-kit',
        jwksUri: 'https://issuer.example/jwks',
        resource: 'https://resource.example',
        availableScopesClaim: 'permissions',
        scopesClaim: 'scope'
      })
    ).toMatchObject({
      issuer: 'https://issuer.example/',
      scopesClaim: ['scope'],
      availableScopesClaim: ['permissions'],
      resource: new URL('https://resource.example')
    })

    expect(
      normalizeOptions({
        issuer: new URL('https://issuer.example'),
        audience: 'mcp-kit',
        jwksUri: 'https://issuer.example/jwks',
        resource: 'https://resource.example',
        scopesClaim: ['scopeA'],
        availableScopesClaim: ['scopeB']
      })
    ).toMatchObject({
      issuer: 'https://issuer.example/',
      scopesClaim: ['scopeA'],
      availableScopesClaim: ['scopeB'],
      resource: new URL('https://resource.example')
    })

    expect(() => normalizeAlgorithm('RS256', ['RS512'])).toThrow(
      'JWT algorithm is not allowed.'
    )
    expect(() => parseJwt('a.b.')).toThrow('JWT signature segment is missing.')
    expect(() =>
      parseJwt(encodedSegment([]) + '.' + encodedSegment({}) + '.x')
    ).toThrow('JWT header must be a JSON object.')
    expect(() =>
      parseJwt(encodedSegment({}) + '.' + encodedSegment([]) + '.x')
    ).toThrow('JWT payload must be a JSON object.')
  })

  it('rejects malformed optional claims and invalid jwks payloads', async () => {
    const pair = createRsaKeyPair('claims-branches')
    const baseFetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: [pair.publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    const verify = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: baseFetch
    })

    await expect(
      verify(
        signJwt(
          {
            iss: '',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60
          },
          pair
        ),
        new Request('https://resource.example')
      )
    ).rejects.toThrow('JWT claim "iss" must be a non-empty string.')

    await expect(
      verify(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60,
            nbf: 'soon'
          },
          pair
        ),
        new Request('https://resource.example')
      )
    ).rejects.toThrow('JWT claim "nbf" must be a number.')

    await expect(
      verify(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60,
            sub: ' '
          },
          pair
        ),
        new Request('https://resource.example')
      )
    ).rejects.toThrow('JWT claim "sub" must be a non-empty string.')

    const invalidJwks = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ keys: 'bad' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    })
    await expect(
      invalidJwks(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60
          },
          pair
        ),
        new Request('https://resource.example')
      )
    ).rejects.toThrow('JWKS response must contain a keys array.')
  })

  it('builds auth context branches and preserves explicit downstream exchange fields', async () => {
    const pair = createRsaKeyPair('authz-branches')
    const consent = {
      subject: 'alice',
      clientId: 'client-1',
      scopes: ['tools:read']
    }
    const verify = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ keys: [pair.publicJwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      ),
      consent: { getConsent: () => Promise.resolve(consent) }
    })

    await expect(
      verify(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60,
            sub: 'alice',
            client_id: 'client-1'
          },
          pair
        ),
        new Request('https://resource.example')
      )
    ).resolves.toMatchObject({
      authorization: { consent }
    })

    const exchange = vi.fn(() =>
      Promise.resolve({ accessToken: 'token', scopes: ['tools:write'] })
    )
    await expect(
      exchangeDownstreamAccessToken(
        { exchange },
        {
          clientId: 'client-1',
          subject: 'alice',
          resource: new URL('https://resource.example')
        },
        {
          clientId: 'client-2',
          subject: 'bob',
          resource: 'https://override.example',
          scopes: ['tools:write']
        }
      )
    ).resolves.toEqual({ accessToken: 'token', scopes: ['tools:write'] })
    expect(exchange).toHaveBeenCalledWith({
      clientId: 'client-2',
      subject: 'bob',
      resource: 'https://override.example',
      scopes: ['tools:write']
    })
  })

  it('loads consent without resource when the verifier has no configured resource', async () => {
    const pair = createRsaKeyPair('consent-no-resource')
    const getConsent = vi.fn(() => Promise.resolve(undefined))
    const verify = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ keys: [pair.publicJwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      ),
      consent: { getConsent }
    })

    await verify(
      signJwt(
        {
          iss: 'https://issuer.example',
          aud: 'mcp-kit',
          exp: Math.floor(Date.now() / 1000) + 60,
          sub: 'alice',
          client_id: 'client-1'
        },
        pair
      ),
      new Request('https://resource.example')
    )

    expect(getConsent).toHaveBeenCalledWith({
      subject: 'alice',
      clientId: 'client-1',
      scopes: []
    })
  })

  it('passes configured resource into consent lookups when present', async () => {
    const pair = createRsaKeyPair('consent-with-resource')
    const getConsent = vi.fn(() => Promise.resolve(undefined))
    const verify = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      resource: 'https://resource.example/mcp',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ keys: [pair.publicJwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      ),
      consent: { getConsent }
    })

    await verify(
      signJwt(
        {
          iss: 'https://issuer.example',
          aud: 'mcp-kit',
          exp: Math.floor(Date.now() / 1000) + 60,
          sub: 'alice',
          client_id: 'client-1'
        },
        pair
      ),
      new Request('https://resource.example')
    )

    expect(getConsent).toHaveBeenCalledWith({
      subject: 'alice',
      clientId: 'client-1',
      scopes: [],
      resource: new URL('https://resource.example/mcp')
    })
  })

  it('omits optional auth fields when absent and exercises discovery parsing branches', async () => {
    const pair = createRsaKeyPair('minimal')
    const verify = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              keys: [{ ...pair.publicJwk, use: undefined, alg: undefined }]
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        )
      )
    })

    const auth = await verify(
      signJwt(
        {
          iss: 'https://issuer.example',
          aud: 'mcp-kit',
          exp: Math.floor(Date.now() / 1000) + 60
        },
        pair
      ),
      new Request('https://resource.example')
    )
    expect(auth.source).toBe('oauth')
    expect(auth.scopes).toEqual([])
    expect(typeof auth.expiresAt).toBe('number')
    expect(auth.extra).toEqual({})

    const badDiscovery = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      discoveryUrl: 'https://issuer.example/.well-known/openid-configuration',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ jwks_uri: '   ' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    })
    await expect(
      badDiscovery(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60
          },
          pair
        ),
        new Request('https://resource.example')
      )
    ).rejects.toThrow('Discovery response must contain jwks_uri.')

    const nonObjectDiscovery = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      discoveryUrl: 'https://issuer.example/.well-known/openid-configuration',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify('bad'), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    })
    await expect(
      nonObjectDiscovery(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60
          },
          pair
        ),
        new Request('https://resource.example')
      )
    ).rejects.toThrow('Discovery response must contain jwks_uri.')
  })

  it('filters unusable jwks entries and reuses in-flight discovery requests', async () => {
    const pair = createRsaKeyPair('filtered')
    let releaseDiscovery = () => {}
    const discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => {
        await discoveryGate
        return new Response(
          JSON.stringify({
            jwks_uri: 'https://issuer.example/jwks'
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      })
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              keys: [
                { ...pair.publicJwk, kty: 'EC' },
                { ...pair.publicJwk, use: 'enc' },
                { ...pair.publicJwk, alg: 'RS512' },
                {
                  ...pair.publicJwk,
                  kid: undefined,
                  use: undefined,
                  alg: undefined
                }
              ]
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        )
      )
    const verify = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      discoveryUrl: 'https://issuer.example/.well-known/openid-configuration',
      fetch
    })
    const token = signJwt(
      {
        iss: 'https://issuer.example',
        aud: 'mcp-kit',
        exp: Math.floor(Date.now() / 1000) + 60
      },
      pair,
      { includeKid: false }
    )

    const first = verify(token, new Request('https://resource.example'))
    const second = verify(token, new Request('https://resource.example'))
    releaseDiscovery()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(2)

    await expect(
      verify(
        `${token.split('.').slice(0, 2).join('.')}.${token.split('.')[2]?.slice(0, -2)}`,
        new Request('https://resource.example')
      )
    ).rejects.toThrow()
  })

  it('uses default jwk cache key parts when key metadata is missing', async () => {
    const pair = createRsaKeyPair('missing-metadata')
    const verify = createJwtBearerVerifier({
      issuer: 'https://issuer.example',
      audience: 'mcp-kit',
      jwksUri: 'https://issuer.example/jwks',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256' }]
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        )
      )
    })

    await expect(
      verify(
        signJwt(
          {
            iss: 'https://issuer.example',
            aud: 'mcp-kit',
            exp: Math.floor(Date.now() / 1000) + 60
          },
          pair,
          { includeKid: false }
        ),
        new Request('https://resource.example')
      )
    ).rejects.toThrow()
  })
})

function encodedSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64url')
    .replace(/=/g, '')
}

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
  options: { includeKid?: boolean } = {}
): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(options.includeKid === false ? {} : { kid: key.kid })
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
