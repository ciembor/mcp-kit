import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { analyzeProject } from './project-analysis.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('project architecture analysis', () => {
  it('accepts inward dependencies and public cross-feature imports', async () => {
    const root = await makeProject()
    await files(root, {
      'src/features/accounts/index.ts':
        "export { getAccount } from './application/get-account.js'\n",
      'src/features/accounts/domain/account.ts':
        'export type Account = { id: string }\n',
      'src/features/accounts/application/get-account.ts':
        "import type { Account } from '../domain/account.js'\nexport function getAccount(): Account { return { id: '1' } }\n",
      'src/features/accounts/mcp/account.tool.ts':
        "import { defineTool } from '@mcp-kit/core'\nimport { z } from 'zod'\nimport { getAccount } from '../application/get-account.js'\nexport const accountTool = defineTool({ name: 'get-account', inputSchema: z.object({}), outputSchema: z.object({ id: z.string() }), annotations: { readOnlyHint: true, openWorldHint: false }, policy: { effects: 'read' }, handler: () => ({ structuredContent: getAccount(), content: [] }) })\n",
      'src/features/reports/index.ts': "export const report = 'report'\n",
      'src/features/reports/application/report.ts':
        "import { getAccount } from '../../accounts/index.js'\nexport const report = getAccount\n",
      'src/mcp/registry.ts':
        "import { defineRegistry } from '@mcp-kit/core'\nimport { accountTool } from '../features/accounts/mcp/account.tool.js'\nexport const tools = defineRegistry([accountTool])\n"
    })

    await expect(analyzeProject(root)).resolves.toMatchObject({
      diagnostics: []
    })
  })

  it('reports forbidden layers, private imports, cycles and missing indexes', async () => {
    const root = await makeProject()
    await files(root, {
      'src/features/a/domain/entity.ts':
        "import '@modelcontextprotocol/sdk/types.js'\nimport { adapter } from '../infrastructure/adapter.js'\nexport const entity = adapter\n",
      'src/features/a/infrastructure/adapter.ts':
        "import { entity } from '../domain/entity.js'\nexport const adapter = entity\n",
      'src/features/b/index.ts': 'export const visible = true\n',
      'src/features/b/domain/private.ts': 'export const hidden = true\n',
      'src/features/a/application/use-case.ts':
        "import { hidden } from '../../b/domain/private.js'\nexport const result = hidden\n",
      'src/server/server.ts':
        "import { hidden } from '../features/b/domain/private.js'\nexport const server = hidden\n"
    })

    const analysis = await analyzeProject(root)
    expect(rules(analysis.diagnostics)).toEqual(
      expect.arrayContaining([
        'domain-dependencies',
        'feature-public-boundary',
        'infrastructure-wiring',
        'no-circular-dependencies',
        'no-mcp-sdk-in-policy',
        'server-dependencies'
      ])
    )
  })

  it('requires infrastructure implementations for application ports', async () => {
    const root = await makeProject()
    await files(root, {
      'src/features/jobs/index.ts':
        "export type { JobStore } from './application/ports/job-store.js'\n",
      'src/features/jobs/application/ports/job-store.ts':
        'export interface JobStore { save(): Promise<void> }\n'
    })

    const missing = await analyzeProject(root)
    expect(rules(missing.diagnostics)).toContain(
      'application-port-implementation'
    )

    await files(root, {
      'src/features/jobs/infrastructure/memory-job-store.ts':
        "import type { JobStore } from '../application/ports/job-store.js'\nexport class MemoryJobStore implements JobStore { async save(): Promise<void> {} }\n"
    })
    const implemented = await analyzeProject(root)
    expect(rules(implemented.diagnostics)).not.toContain(
      'application-port-implementation'
    )
  })

  it('reports MCP-specific contract violations', async () => {
    const root = await makeProject()
    await files(root, {
      'src/features/tools/index.ts':
        "export { brokenTool } from './mcp/broken.tool.js'\n",
      'src/features/tools/mcp/broken.tool.ts':
        "import { definePrompt, defineTool } from '@mcp-kit/core'\nimport { z } from 'zod'\nexport const brokenTool = defineTool({ name: 'list_items', inputSchema: z.object({}), annotations: { readOnlyHint: true }, policy: { effects: 'write', requiredScopes: ['write'] }, handler: () => ({ structuredContent: { ok: true }, content: [] }) })\nexport const duplicateTool = defineTool({ name: 'list_items', inputSchema: z.object({}), handler: () => ({ content: [] }) })\nexport const protectedPrompt = definePrompt({ name: 'protected', requiredScopes: ['prompt'], argsSchema: z.object({}), render: () => ({ messages: [] }) })\n",
      'src/mcp/registry.ts':
        "import { defineRegistry } from '@mcp-kit/core'\nimport { brokenTool, duplicateTool } from '../features/tools/mcp/broken.tool.js'\nexport const tools = defineRegistry([duplicateTool, brokenTool])\n",
      'src/server/transports/stdio.ts':
        "console.log('unsafe')\nexport const stack = new Error().stack\n"
    })

    const analysis = await analyzeProject(root)
    expect(rules(analysis.diagnostics)).toEqual(
      expect.arrayContaining([
        'destructive-hint',
        'deterministic-registry',
        'no-console-log-in-stdio',
        'no-raw-error-stack',
        'no-unbounded-list-tool-without-limit',
        'open-world-hint',
        'policy-annotations',
        'protected-capability-requires-policy',
        'structured-output-requires-output-schema',
        'unique-capability-name'
      ])
    )
  })

  it('reports same-feature outward imports and mixed capability name styles', async () => {
    const root = await makeProject()
    await files(root, {
      'src/features/orders/index.ts':
        "export { orderTool } from './mcp/order.tool.js'\n",
      'src/features/orders/domain/entity.ts':
        "import { registry } from '../../../mcp/registry.js'\nexport const entity = registry\n",
      'src/features/orders/domain/local.ts':
        "import { entity } from './entity.js'\nexport const local = entity\n",
      'src/features/orders/application/use-case.ts':
        "import { adapter } from '../infrastructure/adapter.js'\nimport { orderTool } from '../mcp/order.tool.js'\nexport const useCase = [adapter, orderTool]\n",
      'src/features/orders/application/ports/order-store.ts':
        'interface LocalStore {}\nexport type PortAlias = string\nexport interface OrderStore { save(): Promise<void> }\n',
      'src/features/orders/mcp/order.tool.ts':
        "import { defineTool } from '@mcp-kit/core'\nimport { adapter } from '../infrastructure/adapter.js'\nimport { z } from 'zod'\nconst dynamicName = 'dynamic'\nconst name = 'shorthand'\nconst base = {}\nexport const orderTool = defineTool({ name: 'order-tool', inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }), annotations: { readOnlyHint: 'yes', openWorldHint: false }, policy: { effects: 'read' }, handler: () => ({ structuredContent: { ok: true }, content: [] }) })\nexport const noAnnotationsTool = defineTool({ name: 'read-no-annotations', inputSchema: z.object({}), policy: { effects: 'read' }, handler: () => ({ content: [] }) })\nexport const mixedStyleTool = defineTool({ name: 'mixed_style', inputSchema: z.object({}), handler: () => ({ content: [] }) })\nexport const invalidNameTool = defineTool({ ...base, [dynamicName]: true, name: dynamicName, inputSchema: z.object({}), annotations: {}, policy: { effects: 'write' }, handler: () => ({ content: [] }) })\nexport const shorthandNameTool = defineTool({ name, inputSchema: z.object({}), handler: () => ({ content: [] }) })\nexport const safeWriteTool = defineTool({ name: 'safe-write', inputSchema: z.object({}), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, policy: { effects: 'write' }, handler: () => ({ content: [] }) })\nexport const ignoredDefinition = defineTool('not-an-object')\nexport const adapterUse = adapter\n",
      'src/features/orders/infrastructure/adapter.ts':
        'export class BaseStore {}\nexport class IgnoredStore extends BaseStore {}\nexport class MemoryOrderStore implements OrderStore { async save(): Promise<void> {} }\nexport const adapter = true\n',
      'src/mcp/registry.ts':
        "import { defineRegistry } from '@mcp-kit/core'\nexport const registry = defineRegistry()\ndefineRegistry({})\n"
    })

    const analysis = await analyzeProject(root)
    expect(rules(analysis.diagnostics)).toEqual(
      expect.arrayContaining([
        'application-dependencies',
        'capability-name',
        'capability-name-style',
        'domain-dependencies',
        'mcp-dependencies',
        'policy-annotations'
      ])
    )
    expect(rules(analysis.diagnostics)).not.toContain('deterministic-registry')
  })

  it('parses supported source extensions and propagates unreadable src roots', async () => {
    const root = await makeProject()
    await files(root, {
      'src/features/views/index.tsx': 'export const view = <div />\n',
      'src/features/views/mcp/view.jsx':
        "import { defineResource } from '@mcp-kit/core'\nexport const view = defineResource({ name: 'view', uri: 'view://one', read: () => ({ contents: [] }) })\n",
      'src/features/views/domain/text.txt': 'ignored\n'
    })

    const analysis = await analyzeProject(root)
    expect(analysis.files).toEqual(
      expect.arrayContaining([
        'src/features/views/index.tsx',
        'src/features/views/mcp/view.jsx'
      ])
    )

    const brokenRoot = await makeProject()
    await writeFile(resolve(brokenRoot, 'src'), 'not a directory')
    await expect(analyzeProject(brokenRoot)).rejects.toThrow()
  })
})

async function makeProject(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-architecture-'))
  temporaryDirectories.push(root)
  return root
}

async function files(
  root: string,
  contents: Readonly<Record<string, string>>
): Promise<void> {
  for (const [path, content] of Object.entries(contents)) {
    const absolute = resolve(root, path)
    await mkdir(resolve(absolute, '..'), { recursive: true })
    await writeFile(absolute, content)
  }
}

function rules(diagnostics: readonly { rule: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.rule)
}
