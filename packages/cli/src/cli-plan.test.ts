import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildManifest,
  mergeManifestFiles,
  planAddCapability
} from './cli-plan.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('cli plan helpers', () => {
  it('builds manifests and merges manifest files by path', () => {
    expect(
      buildManifest(
        [
          { kind: 'create', path: 'a.txt', content: 'a' },
          { kind: 'create', path: 'skip.txt' }
        ],
        {
          transport: 'stdio',
          quality: 'standard',
          language: 'typescript',
          packageManager: 'pnpm',
          git: true,
          hooks: true,
          ci: true,
          install: true,
          agent: 'generic',
          force: false,
          dryRun: false
        }
      )
    ).toMatchObject({
      template: 'default',
      files: [{ path: 'a.txt' }]
    })

    expect(
      mergeManifestFiles([
        { path: 'b.txt', checksum: 'old' },
        { path: 'a.txt', checksum: 'a' },
        { path: 'b.txt', checksum: 'new' },
        { ignored: true }
      ])
    ).toEqual([
      { path: 'a.txt', checksum: 'a' },
      { path: 'b.txt', checksum: 'new' }
    ])
  })

  it('plans capability additions and updates manifests', async () => {
    const cwd = await makeTemp()
    await mkdir(resolve(cwd, 'src/mcp'), { recursive: true })
    await mkdir(resolve(cwd, '.mcp-kit'), { recursive: true })
    await writeFile(resolve(cwd, '.mcp-kit/manifest.json'), '{}')

    const manifestPlan = await planAddCapability(cwd, {
      kind: 'tool',
      feature: 'manifest-branch',
      symbol: 'manifestBranch',
      ext: 'ts'
    })
    expect(
      manifestPlan.operations.find(
        (operation) => operation.path === '.mcp-kit/manifest.json'
      )?.kind
    ).toBe('overwrite')

    await rm(resolve(cwd, '.mcp-kit/manifest.json'))
    const createManifestPlan = await planAddCapability(cwd, {
      kind: 'prompt',
      feature: 'manifest-create',
      symbol: 'manifestCreate',
      ext: 'ts'
    })
    expect(
      createManifestPlan.operations.find(
        (operation) => operation.path === '.mcp-kit/manifest.json'
      )?.kind
    ).toBe('create')
  })

  it('plans async tool lifecycle capabilities in one feature module', async () => {
    const cwd = await makeTemp()
    await mkdir(resolve(cwd, 'src/mcp'), { recursive: true })

    const plan = await planAddCapability(cwd, {
      kind: 'tool',
      feature: 'sync-report',
      symbol: 'syncReport',
      ext: 'ts',
      async: true
    })

    const registry = plan.operations.find(
      (operation) => operation.path === 'src/mcp/registry.ts'
    )?.content
    const contract = plan.operations.find(
      (operation) =>
        operation.path === 'test/contracts/sync-report.tool.contract.test.ts'
    )?.content
    const featureModule = plan.operations.find(
      (operation) =>
        operation.path === 'src/features/sync-report/mcp/sync-report.tool.ts'
    )?.content

    expect(registry).toContain('startSyncReportTool')
    expect(registry).toContain('cancelSyncReportTool')
    expect(contract).toContain("expect(startSyncReportTool.name).toBe('start-sync-report')")
    expect(featureModule).toContain('createAsyncJobOperation')
  })
})

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'mcp-kit-cli-plan-'))
  temporaryDirectories.push(directory)
  return directory
}
