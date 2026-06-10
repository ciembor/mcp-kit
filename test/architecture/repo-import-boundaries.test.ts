import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

describe('repo import boundaries', () => {
  it('keeps CLI analysis isolated behind its public shim', async () => {
    const files = await sourceFiles('packages/cli/src')
    const offenders: string[] = []

    for (const file of files) {
      if (file.includes('/analysis/') || file.endsWith('.test.ts')) continue
      for (const specifier of await relativeImports(file)) {
        if (!specifier.includes('/analysis/')) continue
        if (
          file === 'packages/cli/src/project-analysis.ts' ||
          file === 'packages/cli/src/quality/contracts.ts' ||
          file === 'packages/cli/src/quality/run-quality.ts'
        ) {
          continue
        }
        offenders.push(`${file} -> ${specifier}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps CLI quality internals behind the quality barrel', async () => {
    const files = await sourceFiles('packages/cli/src')
    const offenders: string[] = []

    for (const file of files) {
      if (file.includes('/quality/') || file.endsWith('.test.ts')) continue
      for (const specifier of await relativeImports(file)) {
        if (!specifier.includes('/quality/')) continue
        if (file === 'packages/cli/src/quality.ts') continue
        offenders.push(`${file} -> ${specifier}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('prevents core runtime and definitions from depending on app assembly', async () => {
    const files = await sourceFiles('packages/core/src')
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith('.test.ts')) continue
      if (
        file.startsWith('packages/core/src/runtime/') ||
        file.startsWith('packages/core/src/definitions/')
      ) {
        for (const specifier of await relativeImports(file)) {
          if (specifier.includes('/app/')) {
            offenders.push(`${file} -> ${specifier}`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('prevents create-mcp-kit shared and scaffold layers from depending upward', async () => {
    const files = await sourceFiles('packages/create-mcp-kit/src')
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith('.test.ts')) continue
      const imports = await relativeImports(file)

      if (file.startsWith('packages/create-mcp-kit/src/shared/')) {
        for (const specifier of imports) {
          if (
            specifier.includes('/scaffold/') ||
            specifier.includes('/app/')
          ) {
            offenders.push(`${file} -> ${specifier}`)
          }
        }
      }

      if (file.startsWith('packages/create-mcp-kit/src/scaffold/')) {
        for (const specifier of imports) {
          if (specifier.includes('/app/')) {
            offenders.push(`${file} -> ${specifier}`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('prevents testing leaf modules from importing the package root barrel', async () => {
    const files = await sourceFiles('packages/testing/src')
    const offenders: string[] = []

    for (const file of files) {
      if (
        file.endsWith('/index.ts') ||
        file.endsWith('.test.ts') ||
        file.endsWith('/package-info.ts')
      ) {
        continue
      }
      for (const specifier of await relativeImports(file)) {
        if (specifier.endsWith('/index.js')) {
          offenders.push(`${file} -> ${specifier}`)
        }
      }
    }

    expect(offenders).toEqual([])
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

async function relativeImports(file: string): Promise<string[]> {
  const absolute = resolve(repoRoot, file)
  const source = ts.createSourceFile(
    file,
    await readFile(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const imports: string[] = []

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = moduleSpecifierText(statement.moduleSpecifier)
      if (specifier.startsWith('.')) {
        imports.push(normalizeSpecifier(file, specifier))
      }
      continue
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      const specifier = moduleSpecifierText(statement.moduleSpecifier)
      if (specifier.startsWith('.')) {
        imports.push(normalizeSpecifier(file, specifier))
      }
    }
  }

  return imports
}

function normalizeSpecifier(file: string, specifier: string): string {
  return relative(
    repoRoot,
    resolve(repoRoot, dirname(file), specifier)
  ).replaceAll('\\', '/')
}

function moduleSpecifierText(node: ts.Expression): string {
  if (ts.isStringLiteralLike(node)) return node.text
  throw new Error('Expected string literal module specifier')
}
