import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  createMcpApp,
  definePrompt,
  defineRegistry,
  defineResource,
  defineTool,
  McpKitError,
  type InferSchemaOutput
} from './index.js'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

describe('@mcp-kit/core', () => {
  it('infers tool input and exposes request context', async () => {
    const inputSchema = z.object({ name: z.string() })
    type Input = InferSchemaOutput<typeof inputSchema>
    expectTypeOf<Input>().toEqualTypeOf<{ name: string }>()

    const tool = defineTool({
      name: 'hello',
      inputSchema,
      policy: { effects: 'read' },
      annotations: { readOnlyHint: true },
      handler: ({ input, context }) => {
        expectTypeOf(input).toEqualTypeOf<{ name: string }>()
        expect(context.requestId).not.toBe('')
        expect(context.signal).toBeInstanceOf(AbortSignal)
        expect(context.client.info?.name).toBe('core-test')
        expect(context.client.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(context.sdk).toBeDefined()
        return {
          content: [{ type: 'text', text: `Hello ${input.name}` }]
        }
      }
    })
    const app = createMcpApp({
      name: 'core-server',
      version: '1.0.0',
      services: {}
    })
    app.tools([tool])

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'core-test', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    await expect(
      client.callTool({ name: 'hello', arguments: { name: 'Ada' } })
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Hello Ada' }]
    })
    await client.close()
  })

  it('sorts registries deterministically and rejects duplicates', () => {
    expect(
      defineRegistry([{ name: 'z' }, { name: 'a' }]).map(({ name }) => name)
    ).toEqual(['a', 'z'])
    expect(() => defineRegistry([{ name: 'same' }, { name: 'same' }])).toThrow(
      'Duplicate registry entry: same'
    )
  })

  it('rejects inconsistent policy annotations', () => {
    expect(() =>
      defineTool({
        name: 'read',
        inputSchema: z.object({}),
        policy: { effects: 'read' },
        annotations: { readOnlyHint: false },
        handler: () => ({ content: [] })
      })
    ).toThrow('read effects but readOnlyHint is false')
    expect(() =>
      defineTool({
        name: 'write',
        inputSchema: z.object({}),
        policy: { effects: 'write' },
        annotations: { readOnlyHint: true },
        handler: () => ({ content: [] })
      })
    ).toThrow('write effects but readOnlyHint is true')
  })

  it('validates public definition contracts', () => {
    expect(() =>
      defineResource({
        name: 'invalid-resource',
        uri: 'test://x',
        uriTemplate: 'test://{id}',
        read: () => ({ contents: [] })
      } as never)
    ).toThrow('must define exactly one of uri or uriTemplate')
    expect(() =>
      definePrompt({
        name: 'invalid-prompt',
        argsSchema: z.string(),
        render: () => ({ messages: [] })
      })
    ).toThrow('argsSchema must be an object')

    const cause = new Error('cause')
    const error = new McpKitError({
      code: 'TEST',
      message: 'unsafe',
      cause
    })
    expect(error).toMatchObject({
      name: 'McpKitError',
      code: 'TEST',
      safeMessage: 'Operation failed.',
      cause
    })
  })

  it('locks capability registration after connecting', async () => {
    const app = createMcpApp({
      name: 'locked-server',
      version: '1.0.0',
      services: {}
    })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'lock-test', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    expect(() => app.tools([])).toThrow(
      'Capabilities cannot be changed after transport connection'
    )
    await client.close()
  })

  it('returns unknown capability errors and preserves resource metadata', async () => {
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
    const prompt = definePrompt({
      name: 'safe-prompt',
      argsSchema: z.object({}),
      render: () => {
        throw new McpKitError({
          code: 'PROMPT',
          message: 'unsafe prompt detail',
          safeMessage: 'Prompt failed safely.'
        })
      }
    })
    const app = createMcpApp({
      name: 'metadata-server',
      version: '1.0.0',
      services: {}
    })
    app.resources([resource])
    app.prompts([prompt])
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'metadata-test', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    await expect(client.listResources()).resolves.toMatchObject({
      resources: [
        {
          name: 'metadata',
          uri: 'meta://resource',
          title: 'Metadata',
          description: 'Metadata resource',
          mimeType: 'text/plain',
          size: 12,
          _meta: { owner: 'test' }
        }
      ]
    })
    await expect(
      client.readResource({ uri: 'meta://missing' })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await expect(
      client.getPrompt({ name: 'missing-prompt', arguments: {} })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    try {
      await client.getPrompt({ name: 'safe-prompt', arguments: {} })
      throw new Error('Expected prompt to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.InternalError })
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Prompt failed safely.')
    }
    await client.close()
  })

  it('exercises lifecycle helpers, resource templates and prompt validation', async () => {
    const logs: string[] = []
    const logger = {
      debug: (message: string) => logs.push(`debug:${message}`),
      info: (message: string) => logs.push(`info:${message}`),
      warn: (message: string) => logs.push(`warn:${message}`),
      error: (message: string) => logs.push(`error:${message}`)
    }
    const app = createMcpApp({
      name: 'lifecycle-server',
      version: '1.0.0',
      services: {},
      instructions: 'Use this test server.'
    })
    expect(app.connected).toBe(false)
    app.setLogger(logger)
    app.tools([
      defineTool({
        name: 'unexpected-error',
        inputSchema: z.object({}),
        handler: () => {
          throw new Error('unsafe unexpected detail')
        }
      })
    ])
    app.resources([
      defineResource({
        name: 'templated',
        uriTemplate: 'thing://{id}',
        list: ({ cursor }) => ({
          resources: [
            {
              name: cursor ?? 'first',
              uri: `thing://${cursor ?? 'first'}`
            }
          ],
          nextCursor: cursor === undefined ? 'second' : undefined
        }),
        read: ({ params }) => ({
          contents: [{ uri: `thing://${params.id}`, text: params.id }]
        })
      }),
      defineResource({
        name: 'unlisted-template',
        uriTemplate: 'unlisted://{id}',
        read: ({ params }) => ({
          contents: [{ uri: `unlisted://${params.id}`, text: params.id }]
        })
      })
    ])
    app.prompts([
      definePrompt({
        name: 'needs-name',
        argsSchema: z.object({ name: z.string() }),
        render: ({ input }) => ({
          messages: [
            { role: 'user', content: { type: 'text', text: input.name } }
          ]
        })
      }),
      definePrompt({
        name: 'unexpected-prompt',
        argsSchema: z.object({}),
        render: () => {
          throw new Error('unsafe prompt detail')
        }
      })
    ])

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'lifecycle-test', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    expect(app.connected).toBe(true)
    await expect(client.listResources({ cursor: 'custom' })).resolves.toEqual({
      resources: [{ name: 'custom', uri: 'thing://custom' }]
    })
    await expect(client.readResource({ uri: 'thing://42' })).resolves.toEqual({
      contents: [{ uri: 'thing://42', text: '42' }]
    })
    await expect(
      client.readResource({ uri: 'missing-template://42' })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await expect(
      client.getPrompt({ name: 'needs-name', arguments: {} })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await expect(
      client.getPrompt({ name: 'needs-name' })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await expect(
      client.getPrompt({ name: 'unexpected-prompt', arguments: {} })
    ).rejects.toMatchObject({ code: ErrorCode.InternalError })
    await expect(
      client.callTool({ name: 'unexpected-error', arguments: {} })
    ).resolves.toMatchObject({ isError: true })
    expect(logs).toContain('error:Prompt rendering failed')
    expect(logs).toContain('error:Unexpected tool execution error')

    await app.close()
    await client.close()
  })

  it('handles remaining tool protocol and middleware failures', async () => {
    const tools = [
      defineTool({
        name: 'needs-input',
        title: 'Needs Input',
        description: 'Requires input validation.',
        inputSchema: z.object({ name: z.string() }),
        annotations: { readOnlyHint: true },
        handler: ({ input }) => ({
          content: [{ type: 'text', text: input.name }]
        })
      }),
      defineTool({
        name: 'needs-output',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        handler: () => ({ content: [] })
      }),
      defineTool({
        name: 'double-next',
        inputSchema: z.object({}),
        handler: () => ({ content: [] })
      })
    ]
    const app = createMcpApp({
      name: 'tool-failure-server',
      version: '1.0.0',
      services: {},
      middleware: [
        async (_args, next) => {
          await next()
          return next()
        }
      ]
    })
    app.tools(tools)
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'tool-failure-test', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    await expect(
      client.callTool({ name: 'missing-tool', arguments: {} })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await expect(
      client.callTool({ name: 'needs-input' })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await expect(
      client.callTool({ name: 'needs-output', arguments: {} })
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Tool returned no structuredContent required by outputSchema.'
        }
      ]
    })
    const doubleNext = await client.callTool({
      name: 'double-next',
      arguments: {}
    })
    expect(doubleNext.isError).toBe(true)
    expect(JSON.stringify(doubleNext)).toContain(
      'Operation failed. Correlation id:'
    )
    await client.close()
  })

  it('reports invalid structured tool output', async () => {
    const app = createMcpApp({
      name: 'invalid-output-server',
      version: '1.0.0',
      services: {}
    })
    app.tools([
      defineTool({
        name: 'invalid-output',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        handler: () => ({
          content: [],
          structuredContent: { ok: 'nope' }
        })
      })
    ])
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'invalid-output-test', version: '1.0.0' })

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    const result = await client.callTool({
      name: 'invalid-output',
      arguments: {}
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Tool output validation failed.')
    await client.close()
  })

  it('maps client cancellation through timed tool execution', async () => {
    const app = createMcpApp({
      name: 'cancel-server',
      version: '1.0.0',
      services: {}
    })
    app.tools([
      defineTool({
        name: 'cancel-me',
        inputSchema: z.object({}),
        policy: { effects: 'read', timeoutMs: 10_000 },
        handler: () => new Promise(() => {})
      })
    ])
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'cancel-test', version: '1.0.0' },
      { capabilities: {} }
    )
    const controller = new AbortController()

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    const result = client.callTool(
      { name: 'cancel-me', arguments: {} },
      undefined,
      { signal: controller.signal }
    )
    controller.abort(new Error('cancelled by test'))

    await expect(result).rejects.toThrow()
    await client.close()
  })

  it('maps tool timeouts to safe tool errors', async () => {
    const app = createMcpApp({
      name: 'timeout-server',
      version: '1.0.0',
      services: {}
    })
    app.tools([
      defineTool({
        name: 'timeout-me',
        inputSchema: z.object({}),
        policy: { effects: 'read', timeoutMs: 1 },
        handler: () => new Promise(() => {})
      })
    ])
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'timeout-test', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])
    await expect(
      client.callTool({ name: 'timeout-me', arguments: {} })
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'The operation timed out.' }]
    })
    await client.close()
  })

  it('resets connected state when transport connection fails', async () => {
    const app = createMcpApp({
      name: 'connect-failure-server',
      version: '1.0.0',
      services: {}
    })
    const transport = {
      start: () => Promise.reject(new Error('transport failed')),
      send: () => Promise.resolve(),
      close: () => Promise.resolve()
    } as unknown as Transport

    await expect(app.connect(transport)).rejects.toThrow('transport failed')
    expect(app.connected).toBe(false)
  })
})
