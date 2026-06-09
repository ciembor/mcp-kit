import {
  ErrorCode,
  McpError,
  ProgressNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'
import {
  McpKitError,
  createMcpApp,
  definePrompt,
  defineRegistry,
  defineResource,
  defineTool,
  type Logger
} from '../packages/core/src/index.js'
import {
  assertPromptContracts,
  assertResourceContracts,
  assertToolContracts,
  createMcpTestClient
} from '../packages/testing/src/index.js'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

describe('milestone 2 tools', () => {
  it('preserves every legal CallToolResult field and content type', async () => {
    const expected = {
      _meta: { trace: 'abc' },
      content: [
        { type: 'text' as const, text: 'text' },
        {
          type: 'image' as const,
          data: 'aW1hZ2U=',
          mimeType: 'image/png'
        },
        {
          type: 'audio' as const,
          data: 'YXVkaW8=',
          mimeType: 'audio/wav'
        },
        {
          type: 'resource_link' as const,
          uri: 'test://linked',
          name: 'linked'
        },
        {
          type: 'resource' as const,
          resource: {
            uri: 'test://embedded',
            mimeType: 'text/plain',
            text: 'embedded'
          }
        }
      ],
      structuredContent: { ok: true },
      isError: false
    }
    const tool = defineTool({
      name: 'all-content',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: () => expected
    })
    const app = createMcpApp({
      name: 'tools-test',
      version: '1.0.0',
      services: {}
    })
    app.tools([tool])
    const harness = await createMcpTestClient(app)

    await expect(
      harness.client.callTool({ name: tool.name, arguments: {} })
    ).resolves.toEqual(expected)
    await harness.close()
  })

  it('separates protocol validation errors from safe execution errors', async () => {
    const logs: { message: string; data?: Record<string, unknown> }[] = []
    const logger = createCapturingLogger(logs)
    const tools = defineRegistry([
      defineTool({
        name: 'execution-error',
        inputSchema: z.object({}),
        handler: () => {
          throw new McpKitError({
            code: 'DOMAIN_FAILURE',
            message: 'database password leaked in internal detail',
            safeMessage: 'Domain operation failed.'
          })
        }
      }),
      defineTool({
        name: 'invalid-output',
        inputSchema: z.object({}),
        outputSchema: z.object({ count: z.number() }),
        handler: () => ({
          content: [{ type: 'text', text: 'unchanged' }],
          structuredContent: { count: 'not-a-number' }
        })
      }),
      defineTool({
        name: 'validated-input',
        inputSchema: z.object({ count: z.number().int().positive() }),
        handler: ({ input }) => ({
          content: [{ type: 'text', text: String(input.count) }]
        })
      })
    ])
    const app = createMcpApp({
      name: 'error-test',
      version: '1.0.0',
      services: {},
      logger
    })
    app.tools(tools)
    const harness = await createMcpTestClient(app)

    await expect(
      harness.client.callTool({
        name: 'validated-input',
        arguments: { count: -1 }
      })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await expect(
      harness.client.callTool({ name: 'execution-error', arguments: {} })
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Domain operation failed.' }]
    })
    const invalidOutput = await harness.client.callTool({
      name: 'invalid-output',
      arguments: {}
    })
    expect(invalidOutput).toMatchObject({ isError: true })
    const invalidOutputContent = z
      .array(z.object({ type: z.literal('text'), text: z.string() }))
      .parse(invalidOutput.content)
    expect(invalidOutputContent[0]?.text).toContain('Correlation id:')
    expect(JSON.stringify(logs)).not.toContain('password')
    expect(JSON.stringify(logs)).not.toContain('stack')
    await harness.close()
  })

  it('runs middleware in declared order and enforces timeout/concurrency', async () => {
    const order: string[] = []
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const tools = defineRegistry([
      defineTool({
        name: 'concurrent',
        inputSchema: z.object({}),
        policy: { effects: 'read', concurrency: 1 },
        handler: async () => {
          await blocked
          return { content: [{ type: 'text', text: 'done' }] }
        }
      }),
      defineTool({
        name: 'ordered',
        inputSchema: z.object({}),
        handler: () => {
          order.push('handler')
          return { content: [] }
        }
      }),
      defineTool({
        name: 'timeout',
        inputSchema: z.object({}),
        policy: { effects: 'read', timeoutMs: 10 },
        handler: async ({ context }) => {
          await new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () =>
              reject(new Error('x'))
            )
          })
          return { content: [] }
        }
      })
    ])
    const app = createMcpApp({
      name: 'middleware-test',
      version: '1.0.0',
      services: {},
      middleware: [
        async (_args, next) => {
          order.push('first:before')
          const result = await next()
          order.push('first:after')
          return result
        },
        async (_args, next) => {
          order.push('second:before')
          const result = await next()
          order.push('second:after')
          return result
        }
      ]
    })
    app.tools(tools)
    const harness = await createMcpTestClient(app)

    await harness.client.callTool({ name: 'ordered', arguments: {} })
    expect(order).toEqual([
      'first:before',
      'second:before',
      'handler',
      'second:after',
      'first:after'
    ])

    const first = harness.client.callTool({
      name: 'concurrent',
      arguments: {}
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await expect(
      harness.client.callTool({ name: 'concurrent', arguments: {} })
    ).resolves.toMatchObject({ isError: true })
    release!()
    await expect(first).resolves.toMatchObject({
      content: [{ type: 'text', text: 'done' }]
    })
    await expect(
      harness.client.callTool({ name: 'timeout', arguments: {} })
    ).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'The operation timed out.' }]
    })
    await harness.close()
  })

  it('propagates cancellation and emits requested progress', async () => {
    let cancelled = false
    const progress: number[] = []
    const tool = defineTool({
      name: 'long-operation',
      inputSchema: z.object({}),
      handler: async ({ context }) => {
        await context.progress?.report({
          progress: 1,
          total: 2,
          message: 'half'
        })
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            cancelled = true
            resolve()
            return
          }
          context.signal.addEventListener(
            'abort',
            () => {
              cancelled = true
              resolve()
            },
            { once: true }
          )
        })
        return { content: [{ type: 'text', text: 'cancelled' }] }
      }
    })
    const app = createMcpApp({
      name: 'cancel-test',
      version: '1.0.0',
      services: {}
    })
    app.tools([tool])
    const harness = await createMcpTestClient(app)
    harness.client.setNotificationHandler(
      ProgressNotificationSchema,
      (notification) => {
        progress.push(notification.params.progress)
      }
    )
    const controller = new AbortController()
    const call = harness.client.callTool(
      {
        name: tool.name,
        arguments: {},
        _meta: { progressToken: 'progress-1' }
      },
      undefined,
      { signal: controller.signal }
    )

    await vi.waitFor(() => expect(progress).toEqual([1]))
    controller.abort('test cancellation')
    await expect(call).rejects.toBeInstanceOf(McpError)
    await vi.waitFor(() => expect(cancelled).toBe(true))
    await harness.close()
  })

  it('rejects requests for capabilities the server does not declare', async () => {
    const app = createMcpApp({
      name: 'tools-only',
      version: '1.0.0',
      services: {}
    })
    app.tools([
      defineTool({
        name: 'only-tool',
        inputSchema: z.object({}),
        handler: () => ({ content: [] })
      })
    ])
    const harness = await createMcpTestClient(app)

    await expect(harness.client.listResources()).rejects.toMatchObject({
      code: ErrorCode.MethodNotFound
    })
    await harness.close()
  })
})

describe('milestone 2 resources and prompts', () => {
  it('lists paginated resources, types template params and reads text/blob', async () => {
    const staticResource = defineResource({
      name: 'status',
      uri: 'test://status',
      description: 'Static status.',
      mimeType: 'text/plain',
      read: ({ uri }) => ({
        contents: [{ uri: uri.toString(), mimeType: 'text/plain', text: 'ok' }]
      })
    })
    const usersResource = defineResource({
      name: 'user',
      uriTemplate: 'test://users/{userId}',
      description: 'User by id.',
      mimeType: 'application/octet-stream',
      list: ({ cursor }) =>
        cursor === undefined
          ? {
              resources: [{ uri: 'test://users/1', name: 'User 1' }],
              nextCursor: 'page-2'
            }
          : {
              resources: [{ uri: 'test://users/2', name: 'User 2' }]
            },
      read: ({ uri, params }) => {
        const userId: string = params.userId
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: 'application/octet-stream',
              blob: Buffer.from(userId).toString('base64')
            }
          ]
        }
      }
    })
    const app = createMcpApp({
      name: 'resources-test',
      version: '1.0.0',
      services: {}
    })
    app.resources(defineRegistry([usersResource, staticResource]))
    const harness = await createMcpTestClient(app)

    await expect(harness.client.listResources()).resolves.toMatchObject({
      resources: [
        { uri: 'test://status', mimeType: 'text/plain' },
        { uri: 'test://users/1', name: 'User 1' }
      ],
      nextCursor: 'page-2'
    })
    await expect(
      harness.client.listResources({ cursor: 'page-2' })
    ).resolves.toMatchObject({
      resources: [{ uri: 'test://users/2', name: 'User 2' }]
    })
    await expect(
      harness.client.readResource({ uri: 'test://status' })
    ).resolves.toMatchObject({
      contents: [{ text: 'ok', mimeType: 'text/plain' }]
    })
    await expect(
      harness.client.readResource({ uri: 'test://users/42' })
    ).resolves.toMatchObject({
      contents: [
        {
          blob: Buffer.from('42').toString('base64'),
          mimeType: 'application/octet-stream'
        }
      ]
    })
    await harness.close()
  })

  it('supports subscriptions and resource list/update notifications', async () => {
    const resource = defineResource({
      name: 'live',
      uri: 'test://live',
      subscriptions: true,
      read: ({ uri }) => ({
        contents: [{ uri: uri.toString(), text: 'live' }]
      })
    })
    const app = createMcpApp({
      name: 'subscriptions-test',
      version: '1.0.0',
      services: {}
    })
    app.resources([resource])
    const harness = await createMcpTestClient(app)
    const updates: string[] = []
    let listChanged = 0
    harness.client.setNotificationHandler(
      ResourceUpdatedNotificationSchema,
      (notification) => {
        updates.push(notification.params.uri)
      }
    )
    harness.client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      () => {
        listChanged += 1
      }
    )

    await harness.client.subscribeResource({ uri: resource.uri })
    await app.notifyResourceUpdated(resource.uri)
    await vi.waitFor(() => expect(updates).toEqual([resource.uri]))
    await harness.client.unsubscribeResource({ uri: resource.uri })
    await app.notifyResourceUpdated(resource.uri)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(updates).toEqual([resource.uri])
    await app.notifyResourceListChanged()
    await vi.waitFor(() => expect(listChanged).toBe(1))
    await harness.close()
  })

  it('validates prompt arguments and preserves all prompt content types', async () => {
    const prompt = definePrompt({
      name: 'review',
      title: 'Review',
      description: 'Review an item.',
      argsSchema: z.object({ id: z.string().min(1) }),
      render: ({ input }) => ({
        description: `Review ${input.id}`,
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: input.id }
          },
          {
            role: 'assistant',
            content: {
              type: 'image',
              data: 'aW1hZ2U=',
              mimeType: 'image/png'
            }
          },
          {
            role: 'assistant',
            content: {
              type: 'audio',
              data: 'YXVkaW8=',
              mimeType: 'audio/wav'
            }
          },
          {
            role: 'user',
            content: {
              type: 'resource',
              resource: { uri: 'test://prompt', text: 'resource' }
            }
          },
          {
            role: 'user',
            content: {
              type: 'resource_link',
              uri: 'test://linked',
              name: 'linked'
            }
          }
        ]
      })
    })
    const app = createMcpApp({
      name: 'prompts-test',
      version: '1.0.0',
      services: {}
    })
    app.prompts([prompt])
    const harness = await createMcpTestClient(app)

    await expect(harness.client.listPrompts()).resolves.toMatchObject({
      prompts: [{ name: 'review', title: 'Review' }]
    })
    await expect(
      harness.client.getPrompt({ name: 'review', arguments: { id: '42' } })
    ).resolves.toMatchObject({
      description: 'Review 42',
      messages: [
        { content: { type: 'text' } },
        { content: { type: 'image' } },
        { content: { type: 'audio' } },
        { content: { type: 'resource' } },
        { content: { type: 'resource_link' } }
      ]
    })
    await expect(
      harness.client.getPrompt({ name: 'review', arguments: { id: '' } })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    await harness.close()
  })
})

describe('milestone 2 testing contracts', () => {
  it('validates sorted registries for tools, resources and prompts', () => {
    const tools = defineRegistry([
      defineTool({
        name: 'health',
        inputSchema: z.object({}),
        handler: () => ({ content: [] })
      })
    ])
    const resources = defineRegistry([
      defineResource({
        name: 'health',
        uri: 'test://health',
        read: ({ uri }) => ({ contents: [{ uri: uri.toString(), text: 'ok' }] })
      })
    ])
    const prompts = defineRegistry([
      definePrompt({
        name: 'health',
        argsSchema: z.object({}),
        render: () => ({ messages: [] })
      })
    ])

    expect(() => assertToolContracts(tools)).not.toThrow()
    expect(() => assertResourceContracts(resources)).not.toThrow()
    expect(() => assertPromptContracts(prompts)).not.toThrow()
  })
})

function createCapturingLogger(
  entries: { message: string; data?: Record<string, unknown> }[]
): Logger {
  const capture = (message: string, data?: Record<string, unknown>): void => {
    entries.push({ message, ...(data === undefined ? {} : { data }) })
  }
  return {
    debug: capture,
    info: capture,
    warn: capture,
    error: capture
  }
}
