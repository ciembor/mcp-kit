import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import { isTrustedProxy } from './proxy-resolution.js'

const inboundCorrelationHeaders = ['x-request-id', 'x-correlation-id'] as const
const internalCorrelationHeader = 'x-mcp-kit-correlation-id'
const publicCorrelationHeader = 'x-correlation-id'
const correlationIdPattern = /^[A-Za-z0-9._:/=-]{1,128}$/

export function assignCorrelationId(
  req: IncomingMessage,
  trustedProxies: readonly string[]
): string {
  const trustedHeader =
    isTrustedProxy(req, trustedProxies) === true
      ? firstTrustedCorrelationId(req)
      : undefined
  return trustedHeader ?? randomUUID()
}

export function correlationHeaders(
  req: IncomingMessage,
  trustedProxies: readonly string[]
): string {
  return assignCorrelationId(req, trustedProxies)
}

export function setCorrelationHeader(
  headers: Headers,
  correlationId: string
): void {
  headers.set(internalCorrelationHeader, correlationId)
}

export function withCorrelationId(
  response: Response,
  correlationId: string
): Response {
  const headers = new Headers(response.headers)
  headers.set(publicCorrelationHeader, correlationId)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

function firstTrustedCorrelationId(req: IncomingMessage): string | undefined {
  for (const name of inboundCorrelationHeaders) {
    const candidate = headerValue(req.headers[name])
    if (candidate === undefined) continue
    if (!correlationIdPattern.test(candidate)) continue
    return candidate
  }
  return undefined
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
