import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import {
  completable,
  createMcpApp,
  definePrompt,
  defineResource,
  defineTool,
  McpKitError
} from './index.js'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

describe('@mcp-kit/core', () => {
  it('exposes request context to tools', async () => {
    const inputSchema = z.object({ name: z.string() })

    const tool = defineTool({
      name: 'hello',
      inputSchema,
      policy: { effects: 'read' },
      annotations: { readOnlyHint: true },
      handler: ({ input, context }) => {
        expect(input).toEqual({ name: 'Ada' })
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

  it('supports prompt and resource completions through the SDK completion surface', async () => {
    const app = createMcpApp({
      name: 'completion-server',
      version: '1.0.0',
      services: {}
    })
    app.prompts([
      definePrompt({
        name: 'travel',
        argsSchema: z.object({
          city: completable(z.string(), (value) =>
            ['Warsaw', 'Wroclaw'].filter((entry) =>
              entry.toLowerCase().startsWith(value.toLowerCase())
            )
          )
        }),
        render: ({ input }) => ({
          messages: [
            { role: 'user', content: { type: 'text', text: input.city } }
          ]
        })
      })
    ])
    app.resources([
      defineResource({
        name: 'cities',
        uriTemplate: 'city://{id}',
        complete: {
          id: (value) =>
            ['warsaw', 'wroclaw'].filter((entry) => entry.startsWith(value))
        },
        read: ({ params }) => ({
          contents: [{ uri: `city://${params.id}`, text: params.id }]
        })
      })
    ])

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'completion-test', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])

    await expect(
      client.complete({
        ref: { type: 'ref/prompt', name: 'travel' },
        argument: { name: 'city', value: 'wr' }
      })
    ).resolves.toMatchObject({
      completion: { values: ['Wroclaw'] }
    })
    await expect(
      client.complete({
        ref: { type: 'ref/resource', uri: 'city://{id}' },
        argument: { name: 'id', value: 'wr' }
      })
    ).resolves.toMatchObject({
      completion: { values: ['wroclaw'] }
    })

    await client.close()
  })

  it('exposes capability-aware client roots through request context', async () => {
    const app = createMcpApp({
      name: 'roots-server',
      version: '1.0.0',
      services: {}
    })
    app.tools([
      defineTool({
        name: 'inspect-roots',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          const roots = await context.client.roots.list()
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  supported: context.client.roots.supported,
                  listChanged: context.client.roots.listChanged,
                  roots
                })
              }
            ]
          }
        }
      }),
      defineTool({
        name: 'inspect-roots-without-capability',
        inputSchema: z.object({}),
        handler: async ({ context }) => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                supported: context.client.roots.supported,
                roots: await context.client.roots.list()
              })
            }
          ]
        })
      })
    ])

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'roots-test', version: '1.0.0' },
      { capabilities: { roots: { listChanged: true } } }
    )
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: 'file:///workspace', name: 'workspace' }]
    }))

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])

    await expect(
      client.callTool({ name: 'inspect-roots', arguments: {} })
    ).resolves.toMatchObject({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            supported: true,
            listChanged: true,
            roots: [{ uri: 'file:///workspace', name: 'workspace' }]
          })
        }
      ]
    })
    await client.close()
    await app.close()

    const secondApp = createMcpApp({
      name: 'roots-server-missing-capability',
      version: '1.0.0',
      services: {}
    })
    secondApp.tools([
      defineTool({
        name: 'inspect-roots-without-capability',
        inputSchema: z.object({}),
        handler: async ({ context }) => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                supported: context.client.roots.supported,
                roots: await context.client.roots.list()
              })
            }
          ]
        })
      })
    ])

    const [secondClientTransport, secondServerTransport] =
      InMemoryTransport.createLinkedPair()
    const clientWithoutRoots = new Client(
      { name: 'roots-test-missing', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      secondApp.connect(secondServerTransport),
      clientWithoutRoots.connect(secondClientTransport)
    ])

    await expect(
      clientWithoutRoots.callTool({
        name: 'inspect-roots-without-capability',
        arguments: {}
      })
    ).resolves.toMatchObject({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ supported: false, roots: undefined })
        }
      ]
    })
    await clientWithoutRoots.close()
    await secondApp.close()
  })

  it('exposes capability-aware client sampling through request context', async () => {
    const app = createMcpApp({
      name: 'sampling-server',
      version: '1.0.0',
      services: {}
    })
    app.tools([
      defineTool({
        name: 'sample-message',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          const result = await context.client.sampling.createMessage({
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: 'Say hello' }
              }
            ],
            maxTokens: 32
          })

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  supported: context.client.sampling.supported,
                  result
                })
              }
            ]
          }
        }
      }),
      defineTool({
        name: 'sample-message-without-capability',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          await context.client.sampling.createMessage({
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: 'Say hello' }
              }
            ],
            maxTokens: 32
          })
          return { content: [] }
        }
      })
    ])

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'sampling-test', version: '1.0.0' },
      { capabilities: { sampling: {} } }
    )
    client.setRequestHandler(CreateMessageRequestSchema, () => ({
      model: 'test-model',
      role: 'assistant',
      content: { type: 'text', text: 'hello' }
    }))

    await Promise.all([
      app.connect(serverTransport),
      client.connect(clientTransport)
    ])

    await expect(
      client.callTool({ name: 'sample-message', arguments: {} })
    ).resolves.toMatchObject({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            supported: true,
            result: {
              model: 'test-model',
              role: 'assistant',
              content: { type: 'text', text: 'hello' }
            }
          })
        }
      ]
    })
    await client.close()
    await app.close()

    const secondApp = createMcpApp({
      name: 'sampling-server-missing-capability',
      version: '1.0.0',
      services: {}
    })
    secondApp.tools([
      defineTool({
        name: 'sample-message-without-capability',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          await context.client.sampling.createMessage({
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: 'Say hello' }
              }
            ],
            maxTokens: 32
          })
          return { content: [] }
        }
      })
    ])

    const [secondClientTransport, secondServerTransport] =
      InMemoryTransport.createLinkedPair()
    const clientWithoutSampling = new Client(
      { name: 'sampling-test-missing', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.all([
      secondApp.connect(secondServerTransport),
      clientWithoutSampling.connect(secondClientTransport)
    ])

    await expect(
      clientWithoutSampling.callTool({
        name: 'sample-message-without-capability',
        arguments: {}
      })
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Client does not support sampling requests.'
        }
      ]
    })
    await clientWithoutSampling.close()
    await secondApp.close()
  })

  it('exposes capability-aware client elicitation through request context', async () => {
    const app = createMcpApp({
      name: 'elicitation-server',
      version: '1.0.0',
      services: {}
    })
    app.tools([
      defineTool({
        name: 'elicit-form',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          const result = await context.client.elicitation.create({
            message: 'Share your name',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name']
            }
          })

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  supported: context.client.elicitation.supported,
                  form: context.client.elicitation.form,
                  url: context.client.elicitation.url,
                  result
                })
              }
            ]
          }
        }
      }),
      defineTool({
        name: 'elicit-url',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          const result = await context.client.elicitation.create({
            mode: 'url',
            message: 'Open the link',
            url: 'https://example.com/confirm',
            elicitationId: 'el-1'
          })

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  supported: context.client.elicitation.supported,
                  form: context.client.elicitation.form,
                  url: context.client.elicitation.url,
                  result
                })
              }
            ]
          }
        }
      }),
      defineTool({
        name: 'elicit-form-without-support',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          await context.client.elicitation.create({
            message: 'Share your name',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name']
            }
          })
          return { content: [] }
        }
      })
    ])

    const [formClientTransport, formServerTransport] =
      InMemoryTransport.createLinkedPair()
    const formClient = new Client(
      { name: 'elicitation-form-test', version: '1.0.0' },
      { capabilities: { elicitation: {} } }
    )
    formClient.setRequestHandler(ElicitRequestSchema, () => ({
      action: 'accept',
      content: { name: 'Ada' }
    }))

    await Promise.all([
      app.connect(formServerTransport),
      formClient.connect(formClientTransport)
    ])

    await expect(
      formClient.callTool({ name: 'elicit-form', arguments: {} })
    ).resolves.toMatchObject({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            supported: true,
            form: true,
            url: false,
            result: {
              action: 'accept',
              content: { name: 'Ada' }
            }
          })
        }
      ]
    })
    await formClient.close()
    await app.close()

    const urlApp = createMcpApp({
      name: 'elicitation-url-server',
      version: '1.0.0',
      services: {}
    })
    urlApp.tools([
      defineTool({
        name: 'elicit-url',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          const result = await context.client.elicitation.create({
            mode: 'url',
            message: 'Open the link',
            url: 'https://example.com/confirm',
            elicitationId: 'el-1'
          })

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  supported: context.client.elicitation.supported,
                  form: context.client.elicitation.form,
                  url: context.client.elicitation.url,
                  result
                })
              }
            ]
          }
        }
      }),
      defineTool({
        name: 'elicit-form-without-support',
        inputSchema: z.object({}),
        handler: async ({ context }) => {
          await context.client.elicitation.create({
            message: 'Share your name',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name']
            }
          })
          return { content: [] }
        }
      })
    ])

    const [urlClientTransport, urlServerTransport] =
      InMemoryTransport.createLinkedPair()
    const urlClient = new Client(
      { name: 'elicitation-url-test', version: '1.0.0' },
      { capabilities: { elicitation: { url: {} } } }
    )
    urlClient.setRequestHandler(ElicitRequestSchema, () => ({
      action: 'accept'
    }))

    await Promise.all([
      urlApp.connect(urlServerTransport),
      urlClient.connect(urlClientTransport)
    ])

    await expect(
      urlClient.callTool({ name: 'elicit-url', arguments: {} })
    ).resolves.toMatchObject({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            supported: true,
            form: false,
            url: true,
            result: { action: 'accept' }
          })
        }
      ]
    })
    await expect(
      urlClient.callTool({ name: 'elicit-form-without-support', arguments: {} })
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Client does not support form elicitation requests.'
        }
      ]
    })
    await urlClient.close()
    await urlApp.close()
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
      client.callTool({
        name: 'needs-input',
        arguments: { name: 'Ada', extra: true }
      })
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
