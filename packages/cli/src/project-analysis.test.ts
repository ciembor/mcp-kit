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
