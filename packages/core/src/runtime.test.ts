import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import {
  defineResource,
  defineTool,
  McpKitError,
  type RequestContext
} from './index.js'
import {
  resourceMetadata,
  runToolPipeline,
  sdkResourceListCallback,
  silentLogger,
  timeoutAbortError,
  toolConfig,
  trackProtocolVersion
} from './runtime.js'

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

    const protectedTool = defineTool({
      name: 'protected-tool',
      inputSchema: z.object({}),
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
      content: [{ type: 'text', text: 'safe' }]
    })
  })
})

function makeContext(): RequestContext<object> {
  return {
    requestId: 'request-1',
    signal: new AbortController().signal,
    services: {},
    logger: silentLogger,
    client: {
      capabilities: {},
      protocolVersion: LATEST_PROTOCOL_VERSION
    },
    sdk: {} as never
  }
}
