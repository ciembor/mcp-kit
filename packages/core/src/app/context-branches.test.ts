import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { contextFactory, requestContext } from './context.js'

type MockSdk = {
  server: {
    getClientCapabilities: ReturnType<
      typeof vi.fn<() => Record<string, unknown> | undefined>
    >
    getClientVersion: ReturnType<
      typeof vi.fn<() => { name: string; version: string } | undefined>
    >
    listRoots: ReturnType<typeof vi.fn<() => Promise<{ roots: [] }>>>
    createMessage: ReturnType<typeof vi.fn>
    elicitInput: ReturnType<typeof vi.fn>
    createElicitationCompletionNotifier: ReturnType<
      typeof vi.fn<(elicitationId: string) => () => Promise<void>>
    >
  }
}

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
    'uuid-123' as `${string}-${string}-${string}-${string}-${string}`
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestContext branches', () => {
  it('builds anonymous context defaults and reports progress notifications', async () => {
    const sendNotification = vi.fn()
    const sdk = createSdk({
      capabilities: undefined,
      clientVersion: undefined
    })
    const signal = new AbortController().signal

    const context = requestContext(
      {
        requestId: 7,
        signal,
        _meta: { progressToken: 'progress-1' },
        requestInfo: {
          headers: {
            'x-mcp-kit-correlation-id': ['edge-correlation']
          }
        },
        sendNotification
      } as never,
      signal,
      {
        services: { db: 'ok' },
        logger: { info: vi.fn() } as never,
        sdk: sdk as never,
        protocolVersion: ''
      }
    )

    expect(context.requestId).toBe('7')
    expect(context.correlationId).toBe('edge-correlation')
    expect(context.client.capabilities).toEqual({})
    expect(context.client.info).toEqual({ name: '', version: '' })
    expect(context.client.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    expect(context.client.roots.supported).toBe(false)
    await expect(context.client.roots.list()).resolves.toBeUndefined()
    expect(context.client.sampling.supported).toBe(false)
    expect(context.client.elicitation.supported).toBe(false)
    await context.progress?.report({
      progress: 1,
      total: 2,
      message: 'halfway'
    })
    expect(sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: {
        progressToken: 'progress-1',
        progress: 1,
        total: 2,
        message: 'halfway'
      }
    })
    await expect(
      context.client.elicitation.complete('elicitation-1')
    ).rejects.toThrow(
      'Client does not support notifications/elicitation/complete'
    )
  })

  it('falls back to generated correlation ids and anonymous auth details when headers are empty', () => {
    const sdk = createSdk({})

    const context = requestContext(
      {
        requestId: 'request-1',
        signal: new AbortController().signal,
        requestInfo: {
          headers: {
            'x-mcp-kit-correlation-id': ['']
          }
        },
        authInfo: {
          clientId: 'client-1',
          scopes: undefined,
          extra: {
            subject: 123,
            tenantId: false
          }
        }
      } as never,
      new AbortController().signal,
      {
        services: {},
        logger: {} as never,
        sdk: sdk as never,
        protocolVersion: '2026-06-12'
      }
    )

    expect(context.correlationId).toBe('mcp-uuid-123')
    expect(context.auth).toEqual({
      source: 'oauth',
      scopes: [],
      clientId: 'client-1',
      extra: {
        subject: 123,
        tenantId: false
      }
    })
  })

  it('supports complete() when elicitation is available and contextFactory reuses runtime values', async () => {
    const completionNotifier = vi.fn(() => Promise.resolve())
    const sdk = createSdk({
      capabilities: {
        elicitation: {},
        roots: { listChanged: true },
        sampling: {}
      },
      createElicitationCompletionNotifier: vi.fn(() => completionNotifier)
    })
    const runtime = {
      services: { cache: true },
      logger: { warn: vi.fn() } as never,
      sdk: sdk as never,
      protocolVersion: '2026-06-12'
    }
    const buildContext = contextFactory(() => runtime)
    const signal = new AbortController().signal

    const context = buildContext({
      requestId: 'factory-1',
      signal,
      authInfo: undefined,
      requestInfo: {
        headers: {}
      }
    } as never)

    expect(context.services).toBe(runtime.services)
    expect(context.logger).toBe(runtime.logger)
    expect(context.signal).toBe(signal)
    expect(context.client.roots.listChanged).toBe(true)
    expect(context.client.sampling.supported).toBe(true)
    await context.client.elicitation.complete('elicitation-2')
    expect(sdk.server.createElicitationCompletionNotifier).toHaveBeenCalledWith(
      'elicitation-2'
    )
    expect(completionNotifier).toHaveBeenCalledTimes(1)
  })
})

function createSdk(
  overrides: {
    capabilities?: Record<string, unknown> | undefined
    clientVersion?: { name: string; version: string } | undefined
    createElicitationCompletionNotifier?: MockSdk['server']['createElicitationCompletionNotifier']
  } = {}
): MockSdk {
  return {
    server: {
      getClientCapabilities: vi.fn(() => overrides.capabilities),
      getClientVersion: vi.fn(() => overrides.clientVersion),
      listRoots: vi.fn(() => Promise.resolve({ roots: [] })),
      createMessage: vi.fn(),
      elicitInput: vi.fn(),
      createElicitationCompletionNotifier:
        overrides.createElicitationCompletionNotifier ??
        vi.fn(() => vi.fn(() => Promise.resolve()))
    }
  }
}
