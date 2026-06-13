import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RequestContext } from '../definitions.js'
import { defineTool } from '../index.js'
import {
  assertDestructiveConfirmation,
  bindToolIo,
  unavailableToolIo,
  validateToolInputPolicies
} from './tool-io.js'
import {
  assertAllowedOutboundUrl,
  validateHostField,
  validateUrlField
} from './tool-io-network.js'
import {
  resolveToolPath,
  toolFilesystemRoots,
  validateFilesystemPathField
} from './tool-io-filesystem.js'
import {
  paginateItems,
  paginationOptions,
  validateToolResultLimits
} from './tool-io-results.js'
import { normalizeInputError } from './tool-io-errors.js'
import { valueAtPath } from './tool-io-errors.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe('tool io branch coverage', () => {
  it('fails unavailable helpers outside of tool execution', async () => {
    const io = unavailableToolIo()

    await expect(io.files.resolvePath('/tmp/a')).rejects.toMatchObject({
      code: 'POLICY'
    })
    await expect(io.files.roots()).resolves.toEqual([])
    expect(() => io.http.assertAllowed('https://example.com')).toThrow(
      'Tool I/O helpers are only available while executing a tool handler'
    )
    await expect(io.http.fetch('https://example.com')).rejects.toThrow(
      'Tool I/O helpers are only available while executing a tool handler'
    )
    expect(() => io.destructive.assertConfirmation({})).toThrow(
      'Tool I/O helpers are only available while executing a tool handler'
    )
    expect(io.results.paginate({ items: ['a', 'b'], limit: 1 })).toEqual({
      items: ['a'],
      limit: 1,
      nextCursor: '1',
      total: 2
    })
    expect(normalizeInputError('bad', 'tool', 'field')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      safeMessage: 'Input "field" is not allowed.'
    })
    expect(valueAtPath('scalar', 'a.b')).toBeUndefined()
  })

  it('validates input field policies across scalar, collection, url, host and filesystem inputs', async () => {
    const root = await makeFilesystemRoot()
    const tool = defineTool({
      name: 'input-guard',
      inputSchema: z.object({}),
      policy: {
        effects: 'write',
        input: {
          fields: {
            short: { kind: 'string', minLength: 2 },
            long: { kind: 'string', maxLength: 1 },
            whole: { kind: 'number', integer: true, min: 3, max: 4 },
            few: { kind: 'collection', minItems: 2 },
            many: { kind: 'collection', maxItems: 1 },
            url: { kind: 'url', allowHosts: ['api.example.com'] },
            host: { kind: 'host', allowHosts: ['*.example.com'] },
            path: {
              kind: 'filesystemPath',
              roots: [root],
              allowAbsolute: true
            },
            relativePath: {
              kind: 'filesystemPath',
              roots: [root]
            }
          }
        }
      },
      handler: () => ({ content: [] })
    })
    const context = makeContext()

    await expect(
      validateToolInputPolicies(
        tool,
        { short: 'a', long: 'ab', whole: 2.5, few: ['a'], many: ['a', 'b'] },
        context
      )
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })

    await expect(
      validateToolInputPolicies(
        tool,
        {
          short: 'ok',
          long: 'x',
          whole: 3,
          few: ['a', 'b'],
          many: ['a'],
          url: 'https://api.example.com',
          host: 'api.example.com',
          path: join(root.pathname, 'child.txt'),
          relativePath: 'folder/file.txt'
        },
        context
      )
    ).resolves.toBeUndefined()

    await expect(
      validateToolInputPolicies(tool, { whole: 2 }, context)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateToolInputPolicies(tool, { whole: 5 }, context)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateToolInputPolicies(tool, { whole: 3.5 }, context)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateToolInputPolicies(tool, { few: [] }, context)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateToolInputPolicies(
        tool,
        { short: 1, whole: Number.NaN, few: 'nope' },
        context
      )
    ).resolves.toBeUndefined()
  })

  it('enforces destructive confirmations for default and custom fields', () => {
    const defaultTool = defineTool({
      name: 'delete-default',
      inputSchema: z.object({}),
      policy: {
        effects: 'write',
        destructive: { requireConfirmation: true }
      },
      annotations: { destructiveHint: true, readOnlyHint: false },
      handler: () => ({ content: [] })
    })
    const customTool = defineTool({
      name: 'delete-custom',
      inputSchema: z.object({}),
      policy: {
        effects: 'write',
        destructive: { requireConfirmation: { field: 'really', value: 'YES' } }
      },
      annotations: { destructiveHint: true, readOnlyHint: false },
      handler: () => ({ content: [] })
    })

    expect(() => assertDestructiveConfirmation(defaultTool, {})).toThrow(
      'requires destructive confirmation'
    )
    expect(() =>
      assertDestructiveConfirmation(customTool, { really: 'NO' })
    ).toThrow('requires destructive confirmation')
    expect(() =>
      assertDestructiveConfirmation(customTool, { really: 'YES' })
    ).not.toThrow()
  })

  it('validates outbound urls and hosts with security guards', () => {
    const tool = defineTool({
      name: 'network',
      inputSchema: z.object({}),
      policy: {
        effects: 'read',
        outboundHttp: { allowHosts: ['*.example.com'] }
      },
      outputSchema: z.object({ ok: z.boolean() }),
      handler: () => ({ content: [], structuredContent: { ok: true } })
    })

    expect(() =>
      assertAllowedOutboundUrl(tool, 'http://api.example.com')
    ).toThrow('attempted insecure outbound HTTP')
    expect(() =>
      assertAllowedOutboundUrl(tool, 'https://user:pass@api.example.com')
    ).toThrow('attempted outbound URL with embedded credentials')
    expect(() => assertAllowedOutboundUrl(tool, 'https://localhost')).toThrow(
      'attempted private host input localhost'
    )
    expect(() => assertAllowedOutboundUrl(tool, 'https://other.test')).toThrow(
      'attempted non-allowlisted host input other.test'
    )
    expect(
      assertAllowedOutboundUrl(
        defineTool({
          name: 'private-ok',
          inputSchema: z.object({}),
          policy: {
            effects: 'read',
            outboundHttp: {
              allowHosts: ['localhost'],
              allowHttp: true,
              allowPrivateNetworks: true
            }
          },
          outputSchema: z.object({}),
          handler: () => ({ content: [] })
        }),
        new URL('http://localhost')
      ).host
    ).toBe('localhost')
    expect(() =>
      assertAllowedOutboundUrl(
        defineTool({
          name: 'no-outbound',
          inputSchema: z.object({}),
          policy: { effects: 'read' },
          handler: () => ({ content: [] })
        }),
        'https://api.example.com'
      )
    ).toThrow('attempted outbound HTTP without an allowlist')

    expect(() =>
      validateUrlField(
        'network',
        'url',
        { kind: 'url', allowHosts: ['api.example.com'] },
        'ftp://api.example.com'
      )
    ).toThrow('attempted unsupported outbound protocol: ftp:')

    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['api.example.com'] },
        ' '
      )
    ).toThrow('Host input must not be empty')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['api.example.com'] },
        'https://api.example.com/path'
      )
    ).toThrow('Host input must not include a scheme or path')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['api.example.com'] },
        '127.0.0.1'
      )
    ).toThrow('attempted private host input 127.0.0.1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['*.example.com'] },
        'api.example.com'
      )
    ).not.toThrow()
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['api.example.com'] },
        42
      )
    ).not.toThrow()
    expect(() =>
      validateUrlField(
        'network',
        'url',
        { kind: 'url', allowHosts: ['api.example.com'], allowHttp: true },
        'http://api.example.com'
      )
    ).not.toThrow()
    expect(() =>
      validateUrlField(
        'network',
        'url',
        { kind: 'url', allowHosts: ['api.example.com'] },
        42
      )
    ).not.toThrow()
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['fd00::1'] },
        'fd00::1'
      )
    ).toThrow('attempted private host input fd00::1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['10.0.0.1'] },
        '10.0.0.1'
      )
    ).toThrow('attempted private host input 10.0.0.1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['127.0.0.1'] },
        '127.0.0.1'
      )
    ).toThrow('attempted private host input 127.0.0.1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['169.254.1.1'] },
        '169.254.1.1'
      )
    ).toThrow('attempted private host input 169.254.1.1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['192.168.1.1'] },
        '192.168.1.1'
      )
    ).toThrow('attempted private host input 192.168.1.1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['172.16.0.1'] },
        '172.16.0.1'
      )
    ).toThrow('attempted private host input 172.16.0.1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['fe80::1'] },
        'fe80::1'
      )
    ).toThrow('attempted private host input fe80::1')
    expect(() =>
      validateHostField(
        'network',
        'host',
        { kind: 'host', allowHosts: ['8.8.8.8'] },
        '999.0.0.1'
      )
    ).toThrow('attempted non-allowlisted host input 999.0.0.1')
  })

  it('validates filesystem roots, client roots and path resolution', async () => {
    const root = await makeFilesystemRoot()
    const context = makeContext({
      client: {
        ...makeContext().client,
        roots: {
          supported: true,
          listChanged: false,
          list: () =>
            Promise.resolve([
              { uri: 'notaurl', name: 'bad' },
              { uri: 'https://api.example.com', name: 'http' },
              { uri: root.toString(), name: 'file' }
            ])
        }
      }
    })
    const tool = defineTool({
      name: 'fs',
      inputSchema: z.object({}),
      policy: {
        effects: 'read',
        filesystem: { roots: [root], clientRoots: true }
      },
      handler: () => ({ content: [] })
    })

    await expect(toolFilesystemRoots(tool, context)).resolves.toHaveLength(2)
    await expect(
      resolveToolPath(
        tool,
        context,
        new URL(join(root.pathname, 'child.txt'), root)
      )
    ).resolves.toContain('child.txt')
    await expect(
      toolFilesystemRoots(
        defineTool({
          name: 'client-roots-optional',
          inputSchema: z.object({}),
          policy: {
            effects: 'read',
            filesystem: { roots: [root], clientRoots: true }
          },
          handler: () => ({ content: [] })
        }),
        makeContext({
          client: {
            ...makeContext().client,
            roots: {
              supported: false,
              listChanged: false,
              list: () => Promise.resolve(undefined)
            }
          }
        })
      )
    ).resolves.toHaveLength(1)
    await expect(
      toolFilesystemRoots(
        defineTool({
          name: 'bad-root',
          inputSchema: z.object({}),
          policy: {
            effects: 'read',
            filesystem: { roots: [new URL('https://example.com')] }
          },
          handler: () => ({ content: [] })
        }),
        makeContext()
      )
    ).rejects.toThrow('Filesystem root must use file: protocol')

    await expect(
      resolveToolPath(
        defineTool({
          name: 'no-roots',
          inputSchema: z.object({}),
          policy: { effects: 'read' },
          handler: () => ({ content: [] })
        }),
        makeContext(),
        '/tmp/outside.txt'
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      resolveToolPath(tool, context, 'https://api.example.com/file.txt')
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      resolveToolPath(tool, context, '/tmp/outside.txt')
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      validateFilesystemPathField({
        tool,
        context,
        path: 'absolute',
        policy: { kind: 'filesystemPath' },
        value: '/tmp/value'
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateFilesystemPathField({
        tool,
        context,
        path: 'traversal',
        policy: { kind: 'filesystemPath' },
        value: '../escape'
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateFilesystemPathField({
        tool,
        context: makeContext({
          client: {
            ...makeContext().client,
            roots: {
              supported: false,
              listChanged: false,
              list: () => Promise.resolve(undefined)
            }
          }
        }),
        path: 'client-root',
        policy: {
          kind: 'filesystemPath',
          clientRoots: 'require',
          allowAbsolute: true
        },
        value: join(root.pathname, 'child.txt')
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateFilesystemPathField({
        tool,
        context: makeContext({
          client: {
            ...makeContext().client,
            roots: {
              supported: true,
              listChanged: false,
              list: () =>
                Promise.resolve([
                  { uri: 'https://api.example.com', name: 'http' }
                ])
            }
          }
        }),
        path: 'client-root',
        policy: {
          kind: 'filesystemPath',
          clientRoots: 'require',
          allowAbsolute: true
        },
        value: join(root.pathname, 'child.txt')
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      validateFilesystemPathField({
        tool,
        context,
        path: 'client-root',
        policy: {
          kind: 'filesystemPath',
          clientRoots: 'require',
          allowAbsolute: true
        },
        value: join(root.pathname, 'child.txt')
      })
    ).resolves.toBeUndefined()
    await expect(
      validateFilesystemPathField({
        tool,
        context,
        path: 'client-root',
        policy: { kind: 'filesystemPath', roots: [root], allowAbsolute: true },
        value: join(root.pathname, 'child.txt')
      })
    ).resolves.toBeUndefined()
    await expect(
      validateFilesystemPathField({
        tool,
        context,
        path: 'client-root',
        policy: { kind: 'filesystemPath', roots: [root], allowAbsolute: true },
        value: 42
      })
    ).resolves.toBeUndefined()
    await expect(
      resolveToolPath(
        defineTool({
          name: 'missing-root',
          inputSchema: z.object({}),
          policy: {
            effects: 'read',
            filesystem: {
              roots: [new URL('file:///')]
            }
          },
          handler: () => ({ content: [] })
        }),
        makeContext(),
        '/definitely-not-existing-root-level-path-for-mcp-kit/child.txt'
      )
    ).resolves.toContain('child.txt')
    await expect(
      resolveToolPath(
        defineTool({
          name: 'nonexistent-configured-root',
          inputSchema: z.object({}),
          policy: {
            effects: 'read',
            filesystem: {
              roots: ['/definitely-not-existing-root-level-path-for-mcp-kit']
            }
          },
          handler: () => ({ content: [] })
        }),
        makeContext(),
        '/tmp/outside.txt'
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      resolveToolPath(
        defineTool({
          name: 'root-exact',
          inputSchema: z.object({}),
          policy: {
            effects: 'read',
            filesystem: {
              roots: [new URL('file:///')]
            }
          },
          handler: () => ({ content: [] })
        }),
        makeContext(),
        '/'
      )
    ).resolves.toBe('/')
    await expect(
      toolFilesystemRoots(
        defineTool({
          name: 'undefined-client-roots',
          inputSchema: z.object({}),
          policy: {
            effects: 'read',
            filesystem: { roots: [root], clientRoots: true }
          },
          handler: () => ({ content: [] })
        }),
        makeContext({
          client: {
            ...makeContext().client,
            roots: {
              supported: true,
              listChanged: false,
              list: () => Promise.resolve(undefined)
            }
          }
        })
      )
    ).resolves.toHaveLength(1)
    await expect(
      resolveToolPath(
        tool,
        context,
        new URL('https://api.example.com/file.txt')
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('enforces output limits and pagination edge cases', () => {
    const tool = defineTool({
      name: 'results',
      inputSchema: z.object({}),
      policy: {
        effects: 'read',
        output: {
          maxContentItems: 1,
          maxTextChars: 3,
          maxBlobBytes: 2,
          maxStructuredBytes: 5,
          defaultPageSize: 2,
          maxPageSize: 3
        }
      },
      handler: () => ({ content: [] })
    })

    expect(() =>
      validateToolResultLimits(tool, {
        content: [
          { type: 'text', text: 'ok' },
          { type: 'text', text: 'x' }
        ]
      })
    ).toThrow('returned 2 content items')
    expect(() =>
      validateToolResultLimits(tool, {
        content: [{ type: 'text', text: 'long' }]
      })
    ).toThrow('returned text exceeding 3 characters')
    expect(() =>
      validateToolResultLimits(tool, {
        content: [
          {
            type: 'image',
            data: Buffer.from('abcd').toString('base64'),
            mimeType: 'image/png'
          }
        ]
      })
    ).toThrow('returned blob data exceeding 2 bytes')
    expect(() =>
      validateToolResultLimits(tool, {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { text: 'abcdef' }
      })
    ).toThrow('returned structured content exceeding 5 bytes')

    expect(
      paginateItems(
        ['a', 'b', 'c'],
        tool.policy?.output,
        paginationOptions({
          limit: undefined,
          cursor: undefined,
          encodeCursor: undefined,
          decodeCursor: undefined
        })
      )
    ).toEqual({
      items: ['a', 'b'],
      limit: 2,
      nextCursor: '2',
      total: 3
    })
    expect(
      paginateItems(['a', 'b', 'c'], tool.policy?.output, {
        limit: 1,
        cursor: 'cursor:1',
        encodeCursor: (offset) => `cursor:${offset}`,
        decodeCursor: (cursor) => Number(cursor.split(':')[1])
      })
    ).toEqual({
      items: ['b'],
      limit: 1,
      nextCursor: 'cursor:2',
      total: 3
    })
    expect(
      paginateItems(
        ['a'],
        tool.policy?.output,
        paginationOptions({
          limit: 1,
          cursor: undefined,
          encodeCursor: undefined,
          decodeCursor: undefined
        })
      )
    ).toEqual({
      items: ['a'],
      limit: 1,
      total: 1
    })
    expect(
      paginationOptions({
        limit: 1,
        cursor: undefined,
        encodeCursor: String,
        decodeCursor: undefined
      })
    ).toEqual({ limit: 1, encodeCursor: String })
    expect(
      paginationOptions({
        limit: undefined,
        cursor: '1',
        encodeCursor: undefined,
        decodeCursor: Number.parseInt
      })
    ).toEqual({
      cursor: '1',
      decodeCursor: Number.parseInt
    })

    expect(() =>
      paginateItems(['a'], tool.policy?.output, { limit: 0 })
    ).toThrow('Invalid pagination limit: 0')
    expect(() =>
      paginateItems(['a'], tool.policy?.output, { limit: 4 })
    ).toThrow('Requested pagination limit 4 exceeds max page size 3')
    expect(() =>
      paginateItems(['a'], tool.policy?.output, { cursor: '-1' })
    ).toThrow('Invalid pagination cursor offset: -1')
    expect(() =>
      paginateItems(['a'], tool.policy?.output, {
        cursor: 'bad',
        decodeCursor: () => Number.NaN
      })
    ).toThrow('Invalid pagination cursor offset: NaN')
    expect(() =>
      paginateItems(['a'], tool.policy?.output, { cursor: 'bad' })
    ).toThrow('Invalid pagination cursor: bad')
    expect(
      paginateItems(['a', 'b'], tool.policy?.output, { limit: 2, cursor: '0' })
    ).toEqual({
      items: ['a', 'b'],
      limit: 2,
      total: 2
    })
    expect(paginateItems(['a', 'b'], undefined, {})).toEqual({
      items: ['a', 'b'],
      limit: 2,
      total: 2
    })
  })

  it('binds tool io helpers to the tool policy', async () => {
    const root = await makeFilesystemRoot()
    const tool = defineTool({
      name: 'bound',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      policy: {
        effects: 'write',
        filesystem: { roots: [root] },
        outboundHttp: { allowHosts: ['api.example.com'] },
        output: { defaultPageSize: 1, maxPageSize: 2 },
        destructive: { requireConfirmation: true }
      },
      annotations: { destructiveHint: true, readOnlyHint: false },
      handler: () => ({ content: [] })
    })
    const io = bindToolIo(tool, makeContext())

    await expect(io.files.roots()).resolves.toHaveLength(1)
    await expect(
      io.files.resolvePath(join(root.pathname, 'child.txt'))
    ).resolves.toContain('child.txt')
    expect(io.http.assertAllowed('https://api.example.com').host).toBe(
      'api.example.com'
    )
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      io.http.fetch('https://api.example.com/items')
    ).resolves.toMatchObject({
      status: 200
    })
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.example.com/items'),
      {
        redirect: 'manual'
      }
    )
    await expect(io.http.fetch('https://evil.example')).rejects.toMatchObject({
      code: 'FORBIDDEN'
    })
    expect(io.results.paginate({ items: ['a', 'b'] })).toEqual({
      items: ['a'],
      limit: 1,
      nextCursor: '1',
      total: 2
    })
    expect(() => io.destructive.assertConfirmation({ confirm: false })).toThrow(
      'requires destructive confirmation'
    )
    expect(() =>
      assertDestructiveConfirmation(
        defineTool({
          name: 'bound-default-value',
          inputSchema: z.object({}),
          policy: {
            effects: 'write',
            destructive: { requireConfirmation: { field: 'confirm' } }
          },
          annotations: { destructiveHint: true, readOnlyHint: false },
          handler: () => ({ content: [] })
        }),
        { confirm: true }
      )
    ).not.toThrow()
  })
})

async function makeFilesystemRoot(): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-kit-tool-io-'))
  tempDirs.push(dir)
  await mkdir(join(dir, 'nested'), { recursive: true })
  await writeFile(join(dir, 'nested', 'seed.txt'), 'seed')
  return new URL(`file://${dir}/`)
}

function makeContext(
  overrides: Partial<RequestContext<unknown>> = {}
): RequestContext<unknown> {
  const base: RequestContext<unknown> = {
    requestId: 'req-1',
    correlationId: 'corr-1',
    signal: new AbortController().signal,
    services: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    },
    io: unavailableToolIo(),
    client: {
      info: { name: 'test', version: '1.0.0' },
      capabilities: {},
      protocolVersion: '2026-01-01',
      roots: {
        supported: false,
        listChanged: false,
        list: () => Promise.resolve(undefined)
      },
      sampling: {
        supported: false,
        createMessage: () => {
          throw new Error('unsupported')
        }
      },
      elicitation: {
        supported: false,
        form: false,
        url: false,
        create: () => Promise.resolve({ action: 'cancel' }),
        complete: async () => {}
      }
    },
    sdk: {} as RequestContext<unknown>['sdk']
  }
  return { ...base, ...overrides, client: overrides.client ?? base.client }
}
