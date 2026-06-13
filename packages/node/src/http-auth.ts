import type { AuthContext } from '@mcp-kit/core'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

import type {
  StreamableHttpAuthOptions,
  StreamableHttpAuthResult
} from './http-contracts.js'

export async function authenticateRequest(
  request: Request,
  auth: false | StreamableHttpAuthOptions | undefined
): Promise<StreamableHttpAuthResult> {
  if (auth === false || auth === undefined) {
    return {}
  }

  const token = bearerToken(request)
  if (token === null) {
    return {
      rejection: unauthorizedResponse(
        auth.challenge,
        'Invalid Authorization header.'
      )
    }
  }

  if (token === undefined) {
    if (auth.allowAnonymous === true) {
      return {}
    }
    return {
      rejection: unauthorizedResponse(auth.challenge, 'Missing bearer token.')
    }
  }

  try {
    const context = await auth.verifyBearerToken(token, request)
    return {
      auth: context,
      authInfo: toAuthInfo(context)
    }
  } catch {
    return {
      rejection: unauthorizedResponse(auth.challenge, 'Bearer token rejected.')
    }
  }
}

export function sameAuthIdentity(
  left: AuthContext | undefined,
  right: AuthContext | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right

  return left.subject === right.subject && left.tenantId === right.tenantId
}

function bearerToken(request: Request): string | null | undefined {
  const header = request.headers.get('authorization')
  if (header === null) return undefined
  const separator = header.indexOf(' ')
  if (separator === -1) return null
  if (header.slice(0, separator).toLowerCase() !== 'bearer') return null
  const token = header.slice(separator + 1).trim()
  return token === '' ? null : token
}

function unauthorizedResponse(
  challenge: string | undefined,
  message: string
): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8'
  })
  headers.set(
    'www-authenticate',
    challenge ?? 'Bearer realm="mcp-kit", error="invalid_token"'
  )

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message },
      id: null
    }),
    {
      status: 401,
      headers
    }
  )
}

function toAuthInfo(context: AuthContext): AuthInfo {
  return {
    token: '',
    clientId: context.clientId ?? 'mcp-kit',
    scopes: [...context.scopes],
    ...(context.expiresAt === undefined
      ? {}
      : { expiresAt: context.expiresAt }),
    ...(context.resource === undefined ? {} : { resource: context.resource }),
    extra: {
      ...(context.extra ?? {}),
      ...(context.subject === undefined ? {} : { subject: context.subject }),
      ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
      ...(context.authorization === undefined
        ? {}
        : { authorization: context.authorization })
    }
  }
}
