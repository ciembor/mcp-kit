import { z } from 'zod'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  completable,
  definePrompt,
  defineRegistry,
  defineResource,
  defineTool,
  McpKitError,
  packageInfo,
  type InferSchemaOutput
} from './index.js'

describe('definition contracts', () => {
  it('infers tool input and exposes package metadata', () => {
    const inputSchema = z.object({ name: z.string() })
    expect(inputSchema.parse({ name: 'Ada' })).toEqual({ name: 'Ada' })
    type Input = InferSchemaOutput<typeof inputSchema>
    expectTypeOf<Input>().toEqualTypeOf<{ name: string }>()
    expect(packageInfo).toEqual({
      name: '@mcp-kit/core',
      version: '0.0.0'
    })
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
    expect(() =>
      defineTool({
        name: 'destroy',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: false, destructiveHint: true },
        policy: { effects: 'write' },
        handler: () => ({ content: [] })
      })
    ).toThrow('declares destructiveHint but is missing policy.destructive')
    expect(() =>
      defineTool({
        name: 'destroy-read',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, destructiveHint: true },
        policy: { effects: 'read', destructive: {} },
        handler: () => ({ content: [] })
      })
    ).toThrow('destructive policy requires write effects')
    expect(() =>
      defineTool({
        name: 'paged',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
        policy: {
          effects: 'read',
          output: { defaultPageSize: 20, maxPageSize: 10 }
        },
        handler: () => ({ content: [] })
      })
    ).toThrow('output.defaultPageSize must not exceed output.maxPageSize')
    expect(() =>
      defineTool({
        name: 'fetcher',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
        policy: {
          effects: 'read',
          outboundHttp: { allowHosts: ['api.example.com'] }
        },
        handler: () => ({ content: [] })
      })
    ).toThrow('outboundHttp policy requires outputSchema')
    expect(() =>
      defineTool({
        name: 'invalid-timeout',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
        policy: { effects: 'read', timeoutMs: 0 },
        handler: () => ({ content: [] })
      })
    ).toThrow('policy.timeoutMs must be a positive integer')
    expect(() =>
      defineTool({
        name: 'invalid-input-policy',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
        policy: { effects: 'read', input: { fields: {} } },
        handler: () => ({ content: [] })
      })
    ).toThrow('policy.input.fields must not be empty')
    expect(() =>
      defineTool({
        name: 'invalid-url-policy',
        inputSchema: z.object({ url: z.string() }),
        annotations: { readOnlyHint: true, openWorldHint: false },
        policy: {
          effects: 'read',
          input: {
            fields: {
              url: { kind: 'url', allowHosts: [] }
            }
          }
        },
        outputSchema: z.object({ ok: z.boolean() }),
        handler: () => ({ content: [], structuredContent: { ok: true } })
      })
    ).toThrow('policy.input.fields.url.allowHosts must not be empty')
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

    const prompt = definePrompt({
      name: 'complete-me',
      argsSchema: z.object({
        city: completable(z.string(), () => ['Warsaw'])
      }),
      render: () => ({ messages: [] })
    })
    expect(prompt.argsSchema.shape.city).toBeDefined()

    const resource = defineResource({
      name: 'templated',
      uriTemplate: 'thing://{id}',
      complete: {
        id: () => ['42']
      },
      read: ({ params }) => ({
        contents: [{ uri: `thing://${params.id}`, text: params.id }]
      })
    })
    expect(resource.complete?.id).toBeTypeOf('function')
  })
})
