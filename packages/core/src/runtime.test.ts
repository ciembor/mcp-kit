import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'

import { requestContext } from './app/context.js'
import {
  defineResource,
  defineTool,
  McpKitError,
  type RequestContext
} from './index.js'
import {
  resourceMetadata,
  requireCapabilityAccess,
  runToolPipeline,
  sdkResourceListCallback,
  silentLogger,
  timeoutAbortError,
  toolConfig,
  trackProtocolVersion,
  type RuntimePolicyStores,
  type ToolExecutionEvent,
  type ToolMiddlewarePhases
} from './runtime.js'
import { unknownInputPaths } from './runtime/input-validation.js'
import {
  unavailableToolIo,
  validateToolInputPolicies
} from './runtime/tool-io.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('runtime helpers', () => {
  it('builds timeout and cancellation errors', () => {
    const timeoutController = new AbortController()
    const timeoutSignal = new AbortController()
    timeoutController.abort(new Error('timeout'))
    timeoutSignal.abort(new Error('timeout'))

    expect(
      timeoutAbortError(timeoutController.signal, timeoutSignal.signal)
    ).toMatchObject({
      code: 'TIMEOUT',
      safeMessage: 'The operation timed out.'
    })

    const cancelController = new AbortController()
    const inactiveTimeout = new AbortController()
    cancelController.abort(new Error('cancel'))

    expect(
      timeoutAbortError(cancelController.signal, inactiveTimeout.signal)
    ).toMatchObject({
      code: 'CANCELLED',
      safeMessage: 'The operation was cancelled.'
    })
  })

  it('tracks protocol versions through the transport wrapper', async () => {
    const sent: unknown[] = []
    const versions: string[] = []
    const base = {
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
      start: () => Promise.resolve(),
      send: (...args: unknown[]) => {
        sent.push(args)
        return Promise.resolve()
      },
      close: () => {
        sent.push('closed')
        return Promise.resolve()
      },
      setProtocolVersion: (version: string) => {
        versions.push(`set:${version}`)
      }
    } as unknown as Transport
    const transport = trackProtocolVersion(base, (version) => {
      versions.push(version)
    })

    await transport.start()
    base.onmessage?.(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' }
      },
      {}
    )
    base.onmessage?.({ jsonrpc: '2.0', id: 2, method: 'other', params: {} }, {})
    base.onerror?.(new Error('transport error'))
    base.onclose?.()
    await transport.send({ jsonrpc: '2.0', method: 'ping' })
    await transport.close()
    transport.setProtocolVersion?.('2026-01-01')
    silentLogger.debug('debug')
    silentLogger.info('info')
    silentLogger.warn('warn')
    silentLogger.error('error')

    expect(versions).toEqual(['2025-11-25', 'set:2026-01-01'])
    expect(sent).toContain('closed')
  })

  it('maps tool metadata and resource metadata for SDK registration', () => {
    const tool = defineTool({
      name: 'hello',
      title: 'Hello',
      description: 'Greets',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      annotations: { readOnlyHint: true },
      handler: () => ({
        structuredContent: { ok: true },
        content: []
      })
    })
    const resource = defineResource({
      name: 'metadata',
      uri: 'meta://resource',
      title: 'Metadata',
      description: 'Metadata resource',
      mimeType: 'text/plain',
      size: 12,
      annotations: { audience: ['assistant'] },
      icons: [{ src: 'meta://icon' }],
      _meta: { owner: 'test' },
      read: ({ uri }) => ({
        contents: [{ uri: uri.toString(), text: 'ok' }]
      })
    })

    expect(toolConfig(tool)).toMatchObject({
      title: 'Hello',
      description: 'Greets',
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations
    })
    expect(resourceMetadata(resource)).toMatchObject({
      title: 'Metadata',
      description: 'Metadata resource',
      mimeType: 'text/plain',
      size: 12,
      _meta: { owner: 'test' }
    })
  })

  it('creates SDK-compatible resource list callbacks', async () => {
    const resource = defineResource({
      name: 'templated',
      uriTemplate: 'thing://{id}',
      list: ({ context }) => {
        expect(context.requestId).toBe('42')
        expect(context.correlationId).toBe('42')
        expect(context.logger).toBe(silentLogger)
        expect(context.client.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
        return {
          resources: [{ name: 'one', uri: 'thing://one' }],
          nextCursor: 'next'
        }
      },
      read: ({ params }) => ({
        contents: [{ uri: `thing://${params.id}`, text: params.id }]
      })
    })

    await expect(
      sdkResourceListCallback(resource)({
        requestId: 42,
        signal: new AbortController().signal
      } as never)
    ).resolves.toEqual({
      resources: [{ name: 'one', uri: 'thing://one' }],
      nextCursor: 'next'
    })
  })

  it('runs tool middleware with timeout, concurrency and safe error mapping', async () => {
    const context = makeContext()
    const timeoutTool = defineTool({
      name: 'timeout-tool',
      inputSchema: z.object({}),
      policy: { effects: 'read', timeoutMs: 1 },
      handler: () => new Promise(() => {})
    })
    await expect(
      runToolPipeline(timeoutTool, {}, context, [])
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'The operation timed out.' }]
    })

    let releaseBusyGate = () => {}
    const busyGate = new Promise<void>((resolve) => {
      releaseBusyGate = resolve
    })
    const gatedTool = defineTool({
      name: 'gated-tool',
      inputSchema: z.object({}),
      policy: { effects: 'read', concurrency: 1 },
      handler: async () => {
        await busyGate
        return { content: [] }
      }
    })
    const firstCall = runToolPipeline(gatedTool, {}, makeContext(), [])
    await Promise.resolve()
    await expect(
      runToolPipeline(gatedTool, {}, makeContext(), [])
    ).resolves.toMatchObject({
      isError: true,
      content: [
        { type: 'text', text: 'The operation is busy. Try again later.' }
      ]
    })
    releaseBusyGate()
    await firstCall

    const throttledTool = defineTool({
      name: 'throttled-tool',
      inputSchema: z.object({}),
      policy: {
        effects: 'read',
        rateLimit: { windowMs: 60_000, maxCalls: 2 }
      },
      handler: () => ({ content: [] })
    })
    await expect(
      runToolPipeline(
        throttledTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read'],
            subject: 'alice',
            tenantId: 'tenant-a'
          }
        }),
        []
      )
    ).resolves.toMatchObject({ content: [] })
    await expect(
      runToolPipeline(throttledTool, {}, makeContext(), [])
    ).resolves.toMatchObject({ content: [] })
    await expect(
      runToolPipeline(
        throttledTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read'],
            subject: 'alice',
            tenantId: 'tenant-a'
          }
        }),
        []
      )
    ).resolves.toMatchObject({ content: [] })
    await expect(
      runToolPipeline(
        throttledTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read'],
            subject: 'alice',
            tenantId: 'tenant-a'
          }
        }),
        []
      )
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Rate limit exceeded. Try again later.' }]
    })
    await expect(
      runToolPipeline(
        throttledTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read'],
            subject: 'bob',
            tenantId: 'tenant-b'
          }
        }),
        []
      )
    ).resolves.toMatchObject({ content: [] })

    const protectedTool = defineTool({
      name: 'protected-tool',
      inputSchema: z.object({}),
      policy: { effects: 'read', requiredScopes: ['users:read'] },
      handler: () => {
        throw new McpKitError({
          code: 'PROTECTED',
          message: 'unsafe',
          safeMessage: 'safe'
        })
      }
    })
    await expect(
      runToolPipeline(protectedTool, {}, makeContext(), [])
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Permission denied.' }]
    })

    await expect(
      runToolPipeline(
        protectedTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read']
          }
        }),
        []
      )
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'safe' }]
    })

    const stepUpTool = defineTool({
      name: 'step-up-tool',
      inputSchema: z.object({}),
      policy: {
        effects: 'write',
        requiredScopes: ['users:read'],
        stepUpScopes: ['users:write']
      },
      handler: () => ({ content: [] })
    })
    await expect(
      runToolPipeline(
        stepUpTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read']
          }
        }),
        []
      )
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Additional authorization is required.' }]
    })

    const consentTool = defineTool({
      name: 'consent-tool',
      inputSchema: z.object({}),
      policy: {
        effects: 'read',
        requiredScopes: ['users:read'],
        requiredConsentScopes: ['users:read']
      },
      handler: () => ({ content: [] })
    })
    await expect(
      runToolPipeline(
        consentTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read'],
            clientId: 'client-1',
            subject: 'user-1'
          }
        }),
        []
      )
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Additional consent is required.' }]
    })
  })

  it('uses injected policy stores for rate limits and concurrency', async () => {
    const calls: string[] = []
    const stores: RuntimePolicyStores = {
      rateLimit: {
        checkRateLimit: (check) => {
          calls.push(
            `rate:${check.key}:${check.windowMs}:${check.maxCalls}:${check.nowMs > 0}`
          )
          return { allowed: true }
        }
      },
      concurrency: {
        acquireConcurrency: (check) => {
          calls.push(
            `acquire:${check.key}:${check.limit}:${check.leaseMs > 0}:${check.owner.length > 0}`
          )
          return {
            token: 'permit-1',
            release: () => {
              calls.push(`release:${check.key}`)
            }
          }
        }
      },
      idempotency: {
        beginIdempotentRequest: () => ({ kind: 'acquired', token: 'id-1' }),
        completeIdempotentRequest: () => undefined,
        abandonIdempotentRequest: () => undefined
      },
      audit: {
        writeAuditEvent: () => undefined
      }
    }
    const tool = defineTool({
      name: 'stored-policy-tool',
      inputSchema: z.object({}),
      policy: {
        effects: 'read',
        concurrency: 3,
        rateLimit: { windowMs: 1000, maxCalls: 2 }
      },
      handler: () => ({ content: [] })
    })

    await expect(
      runToolPipeline(
        tool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: [],
            subject: 'alice',
            tenantId: 'tenant-a'
          }
        }),
        [],
        stores
      )
    ).resolves.toMatchObject({ content: [] })

    expect(calls).toEqual([
      'rate:stored-policy-tool:alice:tenant-a:1000:2:true',
      'acquire:stored-policy-tool:3:true:true',
      'release:stored-policy-tool'
    ])
  })

  it('runs named middleware phases around policy and handler work', async () => {
    const calls: string[] = []
    const tool = defineTool({
      name: 'phased-tool',
      inputSchema: z.object({}),
      policy: { effects: 'read', requiredScopes: ['users:read'] },
      handler: () => {
        calls.push('handler')
        return { content: [{ type: 'text' as const, text: 'ok' }] }
      }
    })
    const phases: ToolMiddlewarePhases<object> = {
      beforePolicy: [
        async (_args, next) => {
          calls.push('beforePolicy:before')
          const result = await next()
          calls.push('beforePolicy:after')
          return result
        }
      ],
      aroundHandler: [
        async (_args, next) => {
          calls.push('aroundHandler:before')
          const result = await next()
          calls.push('aroundHandler:after')
          return result
        }
      ],
      afterResult: [
        async (_args, next) => {
          calls.push('afterResult:before')
          const result = await next()
          calls.push('afterResult:after')
          return {
            ...result,
            content: [{ type: 'text' as const, text: 'after' }]
          }
        }
      ],
      onError: [
        async (_args, next) => {
          try {
            return await next()
          } catch (error) {
            calls.push(`onError:${error instanceof McpKitError}`)
            throw error
          }
        }
      ]
    }

    await expect(
      runToolPipeline(
        tool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['users:read']
          }
        }),
        [],
        undefined,
        phases
      )
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'after' }]
    })
    expect(calls).toEqual([
      'beforePolicy:before',
      'afterResult:before',
      'aroundHandler:before',
      'handler',
      'aroundHandler:after',
      'afterResult:after',
      'beforePolicy:after'
    ])

    calls.length = 0
    await expect(
      runToolPipeline(tool, {}, makeContext(), [], undefined, phases)
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Permission denied.' }]
    })
    expect(calls).toEqual(['beforePolicy:before', 'onError:true'])
  })

  it('records tool observability events with outcome and latency', async () => {
    const events: ToolExecutionEvent[] = []
    const observability = {
      recordToolExecution: (event: ToolExecutionEvent) => {
        events.push(event)
      }
    }
    const successTool = defineTool({
      name: 'observed-success',
      inputSchema: z.object({}),
      policy: { effects: 'read' },
      handler: () => ({ content: [] })
    })
    const deniedTool = defineTool({
      name: 'observed-denied',
      inputSchema: z.object({}),
      policy: { effects: 'read', requiredScopes: ['users:read'] },
      handler: () => ({ content: [] })
    })
    const rateLimitedTool = defineTool({
      name: 'observed-rate-limit',
      inputSchema: z.object({}),
      policy: {
        effects: 'read',
        rateLimit: { windowMs: 1000, maxCalls: 1 }
      },
      handler: () => ({ content: [] })
    })
    const timeoutTool = defineTool({
      name: 'observed-timeout',
      inputSchema: z.object({}),
      policy: { effects: 'read', timeoutMs: 1 },
      handler: () => new Promise(() => {})
    })
    const stores: RuntimePolicyStores = {
      rateLimit: {
        checkRateLimit: () => ({ allowed: false, retryAfterMs: 1000 })
      },
      concurrency: {
        acquireConcurrency: () => ({ token: 'permit-1', release: () => undefined })
      },
      idempotency: {
        beginIdempotentRequest: () => ({ kind: 'acquired', token: 'id-1' }),
        completeIdempotentRequest: () => undefined,
        abandonIdempotentRequest: () => undefined
      },
      audit: {
        writeAuditEvent: () => undefined
      }
    }

    await expect(
      runToolPipeline(
        successTool,
        {},
        makeContext({
          auth: {
            source: 'oauth',
            scopes: [],
            subject: 'alice',
            tenantId: 'tenant-a'
          }
        }),
        [],
        undefined,
        {},
        observability
      )
    ).resolves.toMatchObject({ content: [] })
    await expect(
      runToolPipeline(
        deniedTool,
        {},
        makeContext(),
        [],
        undefined,
        {},
        observability
      )
    ).resolves.toMatchObject({ isError: true })
    await expect(
      runToolPipeline(
        rateLimitedTool,
        {},
        makeContext(),
        [],
        stores,
        {},
        observability
      )
    ).resolves.toMatchObject({ isError: true })
    await expect(
      runToolPipeline(
        timeoutTool,
        {},
        makeContext(),
        [],
        undefined,
        {},
        observability
      )
    ).resolves.toMatchObject({ isError: true })

    expect(
      events.map(({ tool, outcome, subject, tenantId, durationMs }) => ({
        durationIsNumber: Number.isFinite(durationMs),
        outcome,
        subject,
        tenantId,
        tool
      }))
    ).toEqual([
      {
        durationIsNumber: true,
        outcome: 'success',
        subject: 'alice',
        tenantId: 'tenant-a',
        tool: 'observed-success'
      },
      {
        durationIsNumber: true,
        outcome: 'denied',
        subject: undefined,
        tenantId: undefined,
        tool: 'observed-denied'
      },
      {
        durationIsNumber: true,
        outcome: 'rate_limited',
        subject: undefined,
        tenantId: undefined,
        tool: 'observed-rate-limit'
      },
      {
        durationIsNumber: true,
        outcome: 'timeout',
        subject: undefined,
        tenantId: undefined,
        tool: 'observed-timeout'
      }
    ])
  })

  it('deduplicates write tools with idempotency keys', async () => {
    let calls = 0
    const tool = defineTool({
      name: 'create-payment',
      inputSchema: z.object({ idempotencyKey: z.string() }),
      outputSchema: z.object({ paymentId: z.string() }),
      annotations: { readOnlyHint: false },
      policy: {
        effects: 'write',
        idempotency: true
      },
      handler: () => {
        calls += 1
        return {
          content: [{ type: 'text' as const, text: `payment-${calls}` }],
          structuredContent: { paymentId: `payment-${calls}` }
        }
      }
    })

    await expect(
      runToolPipeline(tool, { idempotencyKey: 'request-1' }, makeContext(), [])
    ).resolves.toMatchObject({
      structuredContent: { paymentId: 'payment-1' }
    })
    await expect(
      runToolPipeline(tool, { idempotencyKey: 'request-1' }, makeContext(), [])
    ).resolves.toMatchObject({
      structuredContent: { paymentId: 'payment-1' }
    })
    await expect(
      runToolPipeline(tool, { idempotencyKey: 'request-2' }, makeContext(), [])
    ).resolves.toMatchObject({
      structuredContent: { paymentId: 'payment-2' }
    })
    await expect(
      runToolPipeline(tool, { idempotencyKey: '' }, makeContext(), [])
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Input "idempotencyKey" must be a non-empty idempotency key.'
        }
      ]
    })
    expect(calls).toBe(2)
  })

  it('rejects concurrent requests with the same idempotency key without double execution', async () => {
    let calls = 0
    let releaseHandler = () => {}
    const running = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    const tool = defineTool({
      name: 'sync-ledger',
      inputSchema: z.object({ idempotencyKey: z.string() }),
      policy: {
        effects: 'write',
        idempotency: true
      },
      handler: async () => {
        calls += 1
        await running
        return {
          content: [{ type: 'text' as const, text: 'done' }]
        }
      }
    })

    const firstCall = runToolPipeline(
      tool,
      { idempotencyKey: 'same-request' },
      makeContext(),
      []
    )
    await Promise.resolve()
    await expect(
      runToolPipeline(
        tool,
        { idempotencyKey: 'same-request' },
        makeContext(),
        []
      )
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'A request with the same idempotency key is already in progress.'
        }
      ]
    })

    releaseHandler()
    await expect(firstCall).resolves.toMatchObject({
      content: [{ type: 'text', text: 'done' }]
    })
    expect(calls).toBe(1)
  })

  it('binds filesystem, outbound HTTP, pagination, output and destructive I/O policies', async () => {
    const clientRoots = {
      supported: true,
      listChanged: false,
      list: () =>
        Promise.resolve([{ uri: 'file:///private/tmp', name: 'workspace' }])
    }
    const tool = defineTool({
      name: 'guarded-io',
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
        confirmDelete: z.literal('DELETE')
      }),
      outputSchema: z.object({
        items: z.array(z.string()),
        limit: z.number(),
        nextCursor: z.string().optional(),
        total: z.number()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false
      },
      policy: {
        effects: 'write',
        filesystem: { clientRoots: 'require' },
        outboundHttp: { allowHosts: ['api.example.com'] },
        output: {
          defaultPageSize: 2,
          maxPageSize: 3,
          maxContentItems: 2,
          maxTextChars: 128,
          maxStructuredBytes: 1024
        },
        destructive: {
          requireConfirmation: { field: 'confirmDelete', value: 'DELETE' }
        }
      },
      handler: async ({ input, context }) => {
        const resolved = await context.io.files.resolvePath(
          'file:///private/tmp/projects/a.txt'
        )
        const outbound = context.io.http.assertAllowed(
          'https://api.example.com/v1/items'
        )
        const page = context.io.results.paginate({
          items: ['a', 'b', 'c', 'd'],
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor })
        })
        context.io.destructive.assertConfirmation(input)
        return {
          content: [{ type: 'text', text: `${resolved}|${outbound.host}` }],
          structuredContent: page
        }
      }
    })

    await expect(
      runToolPipeline(
        tool,
        { confirmDelete: 'DELETE' },
        makeContext({
          client: {
            ...makeContext().client,
            roots: clientRoots
          }
        }),
        []
      )
    ).resolves.toMatchObject({
      structuredContent: {
        items: ['a', 'b'],
        limit: 2,
        nextCursor: '2',
        total: 4
      }
    })

    await expect(
      runToolPipeline(
        tool,
        { confirmDelete: 'DELETE' },
        makeContext({
          client: {
            ...makeContext().client,
            roots: clientRoots
          }
        }),
        [
          async (_args, next) => {
            const result = await next()
            return {
              ...result,
              content: [
                {
                  type: 'text',
                  text: 'too-long-for-the-configured-result-limit-too-long-for-the-configured-result-limit-too-long-for-the-configured-result-limit-too-long-for-the-configured-result-limit-too-long-for-the-configured-result-limit'
                }
              ]
            }
          }
        ]
      )
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'The operation returned too much data.' }]
    })

    await expect(
      runToolPipeline(
        tool,
        { confirmDelete: 'NOPE' },
        makeContext({
          client: {
            ...makeContext().client,
            roots: clientRoots
          }
        }),
        []
      )
    ).resolves.toMatchObject({
      isError: true,
      content: [
        { type: 'text', text: 'This operation requires explicit confirmation.' }
      ]
    })
  })

  it('blocks private and non-allowlisted outbound destinations and invalid pagination limits', async () => {
    const tool = defineTool({
      name: 'http-list-guard',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      policy: {
        effects: 'read',
        outboundHttp: { allowHosts: ['api.example.com'] },
        output: { maxPageSize: 2 }
      },
      handler: ({ context }) => {
        expect(
          safeMessage(() =>
            context.io.http.assertAllowed('https://127.0.0.1/internal')
          )
        ).toBe('Requests to private network targets are not allowed.')
        expect(
          safeMessage(() =>
            context.io.http.assertAllowed('https://evil.example/path')
          )
        ).toBe('The outbound destination is not allowlisted.')
        expect(
          safeMessage(() =>
            context.io.results.paginate({ items: ['a', 'b'], limit: 3 })
          )
        ).toBe('Pagination limit exceeds the configured maximum of 2.')
        return { content: [], structuredContent: { ok: true } }
      }
    })

    await expect(runToolPipeline(tool, {}, makeContext(), [])).resolves.toEqual(
      {
        content: [],
        structuredContent: { ok: true }
      }
    )
  })

  it('rejects path traversal, symlink escape and private-network SSRF targets', async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), 'mcp-kit-runtime-'))
    temporaryDirectories.push(workspace)
    const root = resolve(workspace, 'root')
    const external = resolve(workspace, 'external')
    await mkdir(root)
    await mkdir(external)
    await writeFile(resolve(external, 'secret.txt'), 'secret')
    await symlink(external, resolve(root, 'linked'))

    const tool = defineTool({
      name: 'security-guards',
      inputSchema: z.object({ filePath: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      policy: {
        effects: 'read',
        filesystem: { roots: [root] },
        outboundHttp: { allowHosts: ['api.example.com'] },
        input: {
          fields: {
            filePath: {
              kind: 'filesystemPath',
              roots: [root]
            }
          }
        }
      },
      handler: async ({ context }) => {
        expect(
          await safeMessageAsync(() =>
            context.io.files.resolvePath(resolve(root, 'linked/secret.txt'))
          )
        ).toBe('Filesystem access is outside the configured roots.')
        expect(
          safeMessage(() =>
            context.io.http.assertAllowed('https://[::1]/admin')
          )
        ).toBe('Requests to private network targets are not allowed.')
        return {
          content: [],
          structuredContent: { ok: true }
        }
      }
    })

    await expect(
      validateToolInputPolicies(
        tool,
        { filePath: '../secret.txt' },
        makeContext()
      )
    ).rejects.toMatchObject({
      safeMessage:
        'Input "filePath" must not contain parent traversal segments.'
    })

    await expect(
      runToolPipeline(tool, { filePath: 'safe.txt' }, makeContext(), [])
    ).resolves.toEqual({
      content: [],
      structuredContent: { ok: true }
    })
  })

  it('maps authInfo into auth context and checks capability scopes', async () => {
    const context = requestContext(
      {
        requestId: 7,
        signal: new AbortController().signal,
        authInfo: {
          token: 'secret',
          clientId: 'client-1',
          scopes: ['users:read'],
          extra: {
            subject: 'user-1',
            tenantId: 'tenant-1',
            authorization: {
              availableScopes: ['users:read', 'users:write'],
              consent: {
                subject: 'user-1',
                clientId: 'client-1',
                scopes: ['users:read']
              }
            }
          }
        },
        sendNotification: () => Promise.resolve(),
        sendRequest: () => Promise.resolve({} as never)
      },
      new AbortController().signal,
      {
        services: {},
        logger: silentLogger,
        sdk: {
          server: {
            getClientVersion: () => ({ name: 'client', version: '1.0.0' }),
            getClientCapabilities: () => ({})
          }
        } as never,
        protocolVersion: '2025-11-25'
      }
    )

    expect(context.auth).toMatchObject({
      subject: 'user-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      source: 'oauth',
      scopes: ['users:read'],
      authorization: {
        availableScopes: ['users:read', 'users:write'],
        consent: {
          subject: 'user-1',
          clientId: 'client-1',
          scopes: ['users:read']
        }
      }
    })
    expect(context.auth?.token).toBeUndefined()
    expect(context.correlationId).toMatch(/^mcp-/)

    await expect(
      requireCapabilityAccess({ requiredScopes: ['users:write'] }, context)
    ).rejects.toThrow('Missing required scope: users:write')

    await expect(
      requireCapabilityAccess({ requiredScopes: ['users:read'] }, context)
    ).resolves.toBeUndefined()
    await expect(
      requireCapabilityAccess({ stepUpScopes: ['users:write'] }, context)
    ).rejects.toThrow('Step-up authorization required for scope: users:write')
    await expect(
      requireCapabilityAccess(
        { requiredConsentScopes: ['users:write'] },
        context
      )
    ).rejects.toThrow('Missing consent for scope: users:write')
    await expect(
      requireCapabilityAccess({ requiredScopes: [] }, makeContext())
    ).resolves.toBeUndefined()
  })

  it('prefers transport-provided correlation ids over JSON-RPC request ids', () => {
    const context = requestContext(
      {
        requestId: 'client-visible-id',
        signal: new AbortController().signal,
        requestInfo: {
          headers: {
            'x-mcp-kit-correlation-id': 'edge-correlation-id'
          }
        },
        sendNotification: () => Promise.resolve(),
        sendRequest: () => Promise.resolve({} as never)
      },
      new AbortController().signal,
      {
        services: {},
        logger: silentLogger,
        sdk: {
          server: {
            getClientVersion: () => ({ name: 'client', version: '1.0.0' }),
            getClientCapabilities: () => ({})
          }
        } as never,
        protocolVersion: '2025-11-25'
      }
    )

    expect(context.requestId).toBe('client-visible-id')
    expect(context.correlationId).toBe('edge-correlation-id')
  })

  it('supports custom capability authorization hooks', async () => {
    const context = makeContext({
      auth: {
        source: 'oauth',
        scopes: ['users:read'],
        tenantId: 'tenant-a'
      }
    })

    await expect(
      requireCapabilityAccess(
        {
          authorize(current) {
            if (current.auth?.tenantId !== 'tenant-a') {
              throw new McpKitError({
                code: 'FORBIDDEN',
                message: 'Tenant mismatch',
                safeMessage: 'Permission denied.'
              })
            }
          }
        },
        context
      )
    ).resolves.toBeUndefined()
  })

  it('detects unknown nested input fields', () => {
    expect(
      unknownInputPaths(
        {
          known: {
            keep: true,
            extra: 'drop'
          },
          other: 1
        },
        {
          known: {
            keep: true
          }
        }
      )
    ).toEqual(['known.extra', 'other'])
  })

  it('writes audit events for protected tool calls', async () => {
    const auditEntries: Array<{
      message: string
      data?: Record<string, unknown>
    }> = []
    const logger = {
      debug: () => undefined,
      info: (message: string, data?: Record<string, unknown>) => {
        auditEntries.push(
          data === undefined
            ? { message }
            : {
                message,
                data
              }
        )
      },
      warn: () => undefined,
      error: () => undefined
    }
    const tool = defineTool({
      name: 'audited-tool',
      inputSchema: z.object({}),
      policy: { effects: 'read', requiredScopes: ['users:read'] },
      handler: () => ({ content: [] })
    })

    await expect(
      runToolPipeline(
        tool,
        {},
        makeContext({
          logger,
          auth: {
            source: 'oauth',
            scopes: ['users:read'],
            subject: 'alice',
            tenantId: 'tenant-a'
          }
        }),
        []
      )
    ).resolves.toMatchObject({ content: [] })

    await expect(
      runToolPipeline(tool, {}, makeContext({ logger }), [])
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Permission denied.' }]
    })

    expect(auditEntries).toEqual([
      {
        message: 'Audit event',
        data: {
          correlationId: 'correlation-1',
          outcome: 'success',
          subject: 'alice',
          tenantId: 'tenant-a',
          tool: 'audited-tool'
        }
      },
      {
        message: 'Audit event',
        data: {
          correlationId: 'correlation-1',
          outcome: 'denied',
          tool: 'audited-tool'
        }
      }
    ])
  })

  it('audits tool responses marked as errors', async () => {
    const auditEntries: Array<Record<string, unknown>> = []
    const logger = {
      debug: () => undefined,
      info: (_message: string, data?: Record<string, unknown>) => {
        if (data !== undefined) auditEntries.push(data)
      },
      warn: () => undefined,
      error: () => undefined
    }
    const tool = defineTool({
      name: 'audited-error-tool',
      inputSchema: z.object({}),
      policy: { effects: 'read', requiredScopes: ['users:read'] },
      handler: () => ({
        isError: true as const,
        content: [{ type: 'text', text: 'failed safely' }]
      })
    })

    await expect(
      runToolPipeline(
        tool,
        {},
        makeContext({
          logger,
          auth: {
            source: 'oauth',
            scopes: ['users:read']
          }
        }),
        []
      )
    ).resolves.toMatchObject({ isError: true })

    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        outcome: 'error',
        tool: 'audited-error-tool'
      })
    )
  })
})

function makeContext(
  overrides: Partial<RequestContext<object>> = {}
): RequestContext<object> {
  return {
    requestId: 'request-1',
    correlationId: 'correlation-1',
    signal: new AbortController().signal,
    services: {},
    logger: silentLogger,
    io: unavailableToolIo(),
    client: {
      capabilities: {},
      protocolVersion: LATEST_PROTOCOL_VERSION,
      roots: {
        supported: false,
        listChanged: false,
        list: () => Promise.resolve(undefined)
      },
      sampling: {
        supported: false,
        createMessage: () =>
          Promise.reject(new Error('sampling is not available in this test'))
      },
      elicitation: {
        supported: false,
        form: false,
        url: false,
        create: () =>
          Promise.reject(
            new Error('elicitation is not available in this test')
          ),
        complete: () =>
          Promise.reject(new Error('elicitation is not available in this test'))
      }
    },
    sdk: {} as never,
    ...overrides
  }
}

function safeMessage(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (error instanceof McpKitError) return error.safeMessage
    throw error
  }
  throw new Error('Expected McpKitError')
}

async function safeMessageAsync(
  action: () => Promise<unknown>
): Promise<string> {
  try {
    await action()
  } catch (error) {
    if (error instanceof McpKitError) return error.safeMessage
    throw error
  }
  throw new Error('Expected McpKitError')
}
