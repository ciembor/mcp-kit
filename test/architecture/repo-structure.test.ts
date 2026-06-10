import { access, readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

describe('repo architecture', () => {
  it('keeps package root entrypoints thin', async () => {
    const entrypoints = [
      'packages/cli/src/index.ts',
      'packages/core/src/index.ts',
      'packages/testing/src/index.ts',
      'packages/create-mcp-kit/src/index.ts',
      'packages/cli/src/cli-commands.ts',
      'packages/cli/src/cli-plan.ts',
      'packages/cli/src/cli-render.ts',
      'packages/cli/src/project-analysis.ts',
      'packages/cli/src/quality.ts'
    ]

    for (const path of entrypoints) {
      const source = ts.createSourceFile(
        path,
        await readFile(resolve(repoRoot, path), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      )

      const unsupported = source.statements.filter(
        (statement) =>
          !ts.isExportDeclaration(statement) &&
          !ts.isImportDeclaration(statement) &&
          !ts.isEmptyStatement(statement)
      )

      expect(
        unsupported,
        `${path} should only contain import/export barrel statements`
      ).toEqual([])
    }
  })

  it('does not expose internals exports from package source', async () => {
    const files = await sourceFiles('packages')
    const offenders: string[] = []

    for (const file of files) {
      const content = await readFile(resolve(repoRoot, file), 'utf8')
      if (content.includes('export const internals')) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })

  it('keeps official subsystem directories and removes replaced flat files', async () => {
    await expectPathsExist([
      'packages/cli/src/app',
      'packages/cli/src/commands',
      'packages/cli/src/project',
      'packages/cli/src/quality',
      'packages/cli/src/analysis',
      'packages/core/src/app',
      'packages/testing/src/clients',
      'packages/testing/src/contracts',
      'packages/testing/src/transports',
      'packages/create-mcp-kit/src/app',
      'packages/create-mcp-kit/src/scaffold',
      'packages/create-mcp-kit/src/shared'
    ])

    await expectPathsMissing([
      'packages/cli/src/quality-config.ts',
      'packages/cli/src/quality-execute.ts',
      'packages/cli/src/project-analysis-files.ts',
      'packages/cli/src/project-analysis-helpers.ts',
      'packages/cli/src/project-analysis-imports.ts',
      'packages/cli/src/project-analysis-rules.ts',
      'packages/cli/src/project-analysis-runtime.ts',
      'packages/cli/src/project-analysis-tool-rules.ts',
      'packages/cli/src/project-analysis-types.ts',
      'packages/core/src/app.ts',
      'packages/core/src/app-tool-handlers.ts',
      'packages/core/src/app-resource-handlers.ts'
    ])
  })

  it('forbids internal barrel index files below package root src', async () => {
    const offenders = (await sourceFiles('packages')).filter((file) => {
      if (!file.endsWith('/index.ts')) return false
      const segments = file.split('/')
      return segments.length > 4
    })

    expect(offenders).toEqual([])
  })

  it('keeps packages/node flat until a growth trigger exists', async () => {
    const sourceRoot = resolve(repoRoot, 'packages/node/src')
    const entries = await readdir(sourceRoot, { withFileTypes: true })
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    expect(directories).toEqual([])
  })
})

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  await visit(resolve(repoRoot, root), files)
  return files
}

async function visit(path: string, files: string[]): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'dist') continue
    const absolute = join(path, entry.name)
    if (entry.isDirectory()) {
      await visit(absolute, files)
      continue
    }
    if (entry.name.endsWith('.ts')) {
      files.push(relative(repoRoot, absolute))
    }
  }
}

async function expectPathsExist(paths: readonly string[]): Promise<void> {
  const missing: string[] = []
  for (const path of paths) {
    try {
      await access(resolve(repoRoot, path))
    } catch {
      missing.push(path)
    }
  }
  expect(missing).toEqual([])
}

async function expectPathsMissing(paths: readonly string[]): Promise<void> {
  const present: string[] = []
  for (const path of paths) {
    try {
      await access(resolve(repoRoot, path))
      present.push(path)
    } catch {
      continue
    }
  }
  expect(present).toEqual([])
}
