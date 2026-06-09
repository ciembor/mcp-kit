import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpApp } from '@mcp-kit/core'

const stdioTransports = vi.hoisted(() => [] as MockStdioClientTransport[])
const clients = vi.hoisted(() => [] as MockClient[])

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    readonly info: unknown
    readonly options: unknown
    connect = vi
      .fn<(transport: { start(): Promise<void> }) => Promise<void>>()
      .mockImplementation(async (transport) => {
        await transport.start()
      })
    close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    constructor(info: unknown, options: unknown) {
      this.info = info
      this.options = options
      clients.push(this)
    }
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioClientTransport {
    readonly stderr = new EventEmitter()
    onclose?: () => void
    onerror?: (error: Error) => void
    onmessage?: (message: unknown) => void
    readonly server: unknown

    constructor(server: unknown) {
      this.server = server
      stdioTransports.push(this)
    }

    start = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    send = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  }
}))

import {
  assertPromptContracts,
  assertResourceContracts,
  assertToolContracts,
  connectStdioTestClient,
  createInMemoryMcpTestClient,
  createMcpTestClient
} from './index.js'
import { definePrompt, defineTool } from '@mcp-kit/core'

type MockStdioClientTransport = {
  stderr: EventEmitter
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: unknown) => void
  server: unknown
  start: ReturnType<typeof vi.fn<() => Promise<void>>>
  send: ReturnType<typeof vi.fn<() => Promise<void>>>
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
}

type MockClient = {
  info: unknown
  options: unknown
  connect: ReturnType<
    typeof vi.fn<(transport: { start(): Promise<void> }) => Promise<void>>
  >
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
}

afterEach(() => {
  stdioTransports.splice(0)
  clients.splice(0)
  vi.restoreAllMocks()
})

describe('@mcp-kit/testing', () => {
  it('creates in-memory clients with explicit client metadata and options', async () => {
    const app = { connect: vi.fn<() => Promise<void>>().mockResolvedValue() }
    const client = await createMcpTestClient(
      app as unknown as McpApp<unknown>,
      {
        clientInfo: { name: 'custom-client', version: '2.0.0' },
        clientOptions: { capabilities: { sampling: {} } }
      }
    )
    const alias = await createInMemoryMcpTestClient(
      app as unknown as McpApp<unknown>,
      {
        clientInfo: { name: 'alias-client', version: '2.0.0' }
      }
    )

    await client.close()
    await alias.close()

    expect(app.connect).toHaveBeenCalledTimes(2)
    expect(clients[0]).toMatchObject({
      info: { name: 'custom-client', version: '2.0.0' },
      options: { capabilities: { sampling: {} } }
    })
    expect(clients[1]).toMatchObject({
      info: { name: 'alias-client', version: '2.0.0' },
      options: { capabilities: {} }
    })
  })

  it('rejects invalid tool contract shapes', () => {
    expect(() =>
      assertToolContracts([
        defineTool({
          name: 'write-tool',
          inputSchema: z.object({}),
          policy: { effects: 'write' },
          annotations: { readOnlyHint: true },
          handler: () => ({ content: [] })
        })
      ])
    ).toThrow('write effects but readOnlyHint is true')

    expect(() =>
      assertToolContracts([
        {
          kind: 'tool',
          name: 'write-tool',
          inputSchema: undefined,
          policy: { effects: 'read' },
          handler: () => ({ content: [] })
        } as never
      ])
    ).toThrow('has no input schema')
    expect(() =>
      assertToolContracts([
        {
          kind: 'tool',
          name: 'unsafe-write',
          inputSchema: z.object({}),
          policy: { effects: 'write' },
          annotations: {},
          handler: () => ({ content: [] })
        } as never
      ])
    ).toThrow('must set readOnlyHint to false')
  })

  it('rejects invalid resource and prompt contracts', () => {
    expect(() => assertResourceContracts([{ name: 'missing-uri' }])).toThrow(
      'has no URI'
    )
    expect(() =>
      assertPromptContracts([
        {
          kind: 'prompt',
          name: 'missing-args',
          argsSchema: undefined,
          render: () => ({ messages: [] })
        } as never
      ])
    ).toThrow('has no args schema')
  })

  it('rejects empty, duplicate and unsorted registries', () => {
    const prompt = (name: string) =>
      definePrompt({
        name,
        argsSchema: z.object({}),
        render: () => ({ messages: [] })
      })

    expect(() => assertPromptContracts([prompt('')])).toThrow(
      'name cannot be empty'
    )
    expect(() => assertPromptContracts([prompt('a'), prompt('a')])).toThrow(
      'Duplicate prompt name'
    )
    expect(() => assertPromptContracts([prompt('b'), prompt('a')])).toThrow(
      'prompt registry is not sorted'
    )
    expect(() => assertPromptContracts([prompt('a'), prompt('b')])).not.toThrow()
  })

  it('tracks stdio protocol version, stderr, send, close and callbacks', async () => {
    const client = await connectStdioTestClient(
      { command: 'node', args: ['server.js'] },
      { name: 'stdio-test', version: '1.0.0' }
    )
    const transport = stdioTransports[0]
    if (transport === undefined) throw new Error('missing mock transport')

    transport.stderr.emit('data', 'first')
    transport.stderr.emit('data', Buffer.from(' second'))
    transport.onmessage?.({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-11-25' }
    })
    transport.onmessage?.({ jsonrpc: '2.0', method: 'ping' })
    const error = new Error('stdio failed')
    transport.onerror?.(error)
    transport.onclose?.()

    await client.transport.send({ jsonrpc: '2.0', method: 'ping' })
    await client.close()

    expect(client.stderr()).toBe('first second')
    expect(client.protocolVersion()).toBe('2025-11-25')
    expect(transport.server).toMatchObject({
      command: 'node',
      args: ['server.js'],
      stderr: 'pipe'
    })
    expect(transport.send).toHaveBeenCalled()
    expect(clients[0]?.close).toHaveBeenCalled()
  })
})
