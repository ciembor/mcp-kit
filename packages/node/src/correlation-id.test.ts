import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { randomUUIDMock } = vi.hoisted(() => ({
  randomUUIDMock: vi.fn()
}))

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock
}))

import {
  correlationHeaders,
  setCorrelationHeader,
  withCorrelationId
} from './correlation-id.js'

afterEach(() => {
  randomUUIDMock.mockReset()
})

describe('correlation id handling', () => {
  it('reuses the first trusted inbound correlation id', () => {
    const request = createRequest({
      remoteAddress: '127.0.0.1',
      headers: {
        'x-request-id': ['edge-request-1', 'edge-request-2'],
        'x-correlation-id': 'fallback-id'
      }
    })

    expect(correlationHeaders(request, ['127.0.0.1'])).toBe('edge-request-1')
    expect(randomUUIDMock).not.toHaveBeenCalled()
  })

  it('falls back to a generated id for untrusted or invalid inbound ids', () => {
    randomUUIDMock
      .mockReturnValueOnce('generated-untrusted')
      .mockReturnValueOnce('generated-invalid')

    const untrusted = createRequest({
      remoteAddress: '203.0.113.10',
      headers: {
        'x-request-id': 'edge-request'
      }
    })
    const invalidTrusted = createRequest({
      remoteAddress: '127.0.0.1',
      headers: {
        'x-request-id': 'not allowed!'
      }
    })

    expect(correlationHeaders(untrusted, ['127.0.0.1'])).toBe(
      'generated-untrusted'
    )
    expect(correlationHeaders(invalidTrusted, ['127.0.0.1'])).toBe(
      'generated-invalid'
    )
  })

  it('uses x-correlation-id when x-request-id is absent', () => {
    const request = createRequest({
      remoteAddress: '::ffff:127.0.0.1',
      headers: {
        'x-correlation-id': 'proxy-correlation-id'
      }
    })

    expect(correlationHeaders(request, ['127.0.0.1'])).toBe(
      'proxy-correlation-id'
    )
  })

  it('writes internal and public correlation headers without losing metadata', async () => {
    const headers = new Headers()
    setCorrelationHeader(headers, 'internal-123')

    expect(headers.get('x-mcp-kit-correlation-id')).toBe('internal-123')

    const response = withCorrelationId(
      new Response('ok', {
        status: 202,
        statusText: 'Accepted',
        headers: { 'content-type': 'text/plain' }
      }),
      'public-123'
    )

    expect(response.status).toBe(202)
    expect(response.statusText).toBe('Accepted')
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(response.headers.get('x-correlation-id')).toBe('public-123')
    await expect(response.text()).resolves.toBe('ok')
  })
})

function createRequest({
  remoteAddress,
  headers
}: {
  remoteAddress?: string
  headers: Record<string, string | string[] | undefined>
}): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress }
  } as IncomingMessage
}
