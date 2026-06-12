import { describe, expect, it, vi } from 'vitest'

import { authenticateRequest, sameAuthIdentity } from './http-auth.js'

describe('authenticateRequest', () => {
  it('skips authentication when auth is disabled', async () => {
    const request = new Request('http://localhost/mcp')

    await expect(authenticateRequest(request, false)).resolves.toEqual({})
    await expect(authenticateRequest(request, undefined)).resolves.toEqual({})
  })

  it('rejects malformed authorization headers', async () => {
    const missingBearer = await authenticateRequest(
      new Request('http://localhost/mcp', {
        headers: { authorization: 'Basic abc' }
      }),
      authOptions()
    )
    const missingSeparator = await authenticateRequest(
      new Request('http://localhost/mcp', {
        headers: { authorization: 'Bearer' }
      }),
      authOptions()
    )
    const emptyBearer = await authenticateRequest(
      {
        headers: {
          get(name: string) {
            return name === 'authorization' ? 'Bearer   ' : null
          }
        }
      } as unknown as Request,
      authOptions()
    )

    await expect(rejectionBody(missingBearer.rejection)).resolves.toMatchObject({
      error: { message: 'Invalid Authorization header.' }
    })
    expect(missingBearer.rejection?.headers.get('www-authenticate')).toBe(
      'Bearer realm="mcp-kit", error="invalid_token"'
    )
    await expect(
      rejectionBody(missingSeparator.rejection)
    ).resolves.toMatchObject({
      error: { message: 'Invalid Authorization header.' }
    })
    await expect(rejectionBody(emptyBearer.rejection)).resolves.toMatchObject({
      error: { message: 'Invalid Authorization header.' }
    })
  })

  it('allows anonymous requests only when explicitly enabled', async () => {
    const request = new Request('http://localhost/mcp')

    await expect(
      authenticateRequest(request, {
        ...authOptions(),
        allowAnonymous: true
      })
    ).resolves.toEqual({})

    const rejected = await authenticateRequest(request, {
      ...authOptions(),
      challenge: 'Bearer realm="private"'
    })

    await expect(rejectionBody(rejected.rejection)).resolves.toMatchObject({
      error: { message: 'Missing bearer token.' }
    })
    expect(rejected.rejection?.headers.get('www-authenticate')).toBe(
      'Bearer realm="private"'
    )
  })

  it('returns auth context and auth info for accepted bearer tokens', async () => {
    const verifyBearerToken = vi.fn(async () => ({
      clientId: undefined,
      scopes: ['users:read'],
      subject: 'alice',
      tenantId: 'tenant-a',
      resource: 'resource-1',
      extra: { role: 'admin' }
    }))
    const request = new Request('http://localhost/mcp', {
      headers: { authorization: 'Bearer alice-token' }
    })

    const result = await authenticateRequest(request, {
      verifyBearerToken
    })

    expect(verifyBearerToken).toHaveBeenCalledWith('alice-token', request)
    expect(result.auth).toMatchObject({
      scopes: ['users:read'],
      subject: 'alice',
      tenantId: 'tenant-a'
    })
    expect(result.authInfo).toEqual({
      token: 'alice-token',
      clientId: 'mcp-kit',
      scopes: ['users:read'],
      resource: 'resource-1',
      extra: {
        role: 'admin',
        subject: 'alice',
        tenantId: 'tenant-a'
      }
    })
  })

  it('keeps optional auth info fields absent when the context does not provide them', async () => {
    const expiresAt = new Date('2026-06-12T00:00:00.000Z')
    const request = new Request('http://localhost/mcp', {
      headers: { authorization: 'Bearer service-token' }
    })

    const result = await authenticateRequest(request, {
      verifyBearerToken: async () => ({
        clientId: 'service-client',
        scopes: ['service:read'],
        expiresAt
      })
    })

    expect(result.authInfo).toEqual({
      token: 'service-token',
      clientId: 'service-client',
      scopes: ['service:read'],
      expiresAt,
      extra: {}
    })
  })

  it('rejects bearer tokens when verification fails', async () => {
    const result = await authenticateRequest(
      new Request('http://localhost/mcp', {
        headers: { authorization: 'Bearer rejected-token' }
      }),
      {
        verifyBearerToken: async () => {
          throw new Error('nope')
        }
      }
    )

    await expect(rejectionBody(result.rejection)).resolves.toMatchObject({
      error: { message: 'Bearer token rejected.' }
    })
  })
})

describe('sameAuthIdentity', () => {
  it('compares undefined and concrete identities correctly', () => {
    expect(sameAuthIdentity(undefined, undefined)).toBe(true)
    expect(
      sameAuthIdentity(undefined, {
        scopes: [],
        subject: 'alice'
      })
    ).toBe(false)
  })

  it('compares subject and tenant identity only', () => {
    expect(
      sameAuthIdentity(
        {
          clientId: 'client-a',
          scopes: ['users:read'],
          subject: 'alice',
          tenantId: 'tenant-a'
        },
        {
          clientId: 'client-b',
          scopes: ['users:write'],
          subject: 'alice',
          tenantId: 'tenant-a'
        }
      )
    ).toBe(true)
    expect(
      sameAuthIdentity(
        {
          scopes: [],
          subject: 'alice',
          tenantId: 'tenant-a'
        },
        {
          scopes: [],
          subject: 'bob',
          tenantId: 'tenant-a'
        }
      )
    ).toBe(false)
  })
})

function authOptions() {
  return {
    verifyBearerToken: async () => ({
      clientId: 'client-1',
      scopes: ['users:read']
    })
  }
}

async function rejectionBody(response: Response | undefined) {
  return JSON.parse(await response!.text()) as {
    error: { message: string }
  }
}
