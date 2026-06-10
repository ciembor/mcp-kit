import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readSourceFiles } from './project-analysis-files.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('project analysis source file reader', () => {
  it('returns only supported source files with relative normalized paths and script kinds', async () => {
    const root = await makeProject()
    await files(root, {
      'src/feature.ts': 'export const tsFile = true\n',
      'src/view.tsx': 'export const view = <div />\n',
      'src/client.js': 'export const client = true\n',
      'src/client.jsx': 'export const jsxClient = <div />\n',
      'src/module.mjs': 'export const moduleFile = true\n',
      'src/common.cjs': 'module.exports = { common: true }\n',
      'src/ignored.json': '{"ignored":true}\n'
    })

    const filesRead = await readSourceFiles(root)
    const byPath = new Map(filesRead.map((file) => [file.path, file]))

    const paths = Array.from(byPath.keys())
    expect([...paths].sort()).toEqual([
      'src/client.js',
      'src/client.jsx',
      'src/common.cjs',
      'src/feature.ts',
      'src/module.mjs',
      'src/view.tsx'
    ])

    expect(scriptKind(byPath.get('src/feature.ts'))).toBe(
      ts.ScriptKind.TS
    )
    expect(scriptKind(byPath.get('src/view.tsx'))).toBe(
      ts.ScriptKind.TSX
    )
    expect(scriptKind(byPath.get('src/client.js'))).toBe(
      ts.ScriptKind.JS
    )
    expect(scriptKind(byPath.get('src/client.jsx'))).toBe(
      ts.ScriptKind.JSX
    )
    expect(scriptKind(byPath.get('src/module.mjs'))).toBe(
      ts.ScriptKind.JS
    )
    expect(scriptKind(byPath.get('src/common.cjs'))).toBe(
      ts.ScriptKind.JS
    )
    expect(byPath.get('src/feature.ts')?.absolute).toBe(
      resolve(root, 'src/feature.ts')
    )
  })

  it('supports custom source directories and missing directories', async () => {
    const root = await makeProject()
    await files(root, {
      'lib/index.ts': 'export const library = true\n'
    })

    await expect(readSourceFiles(root, 'lib')).resolves.toMatchObject([
      { path: 'lib/index.ts' }
    ])
    await expect(readSourceFiles(root, 'missing')).resolves.toEqual([])
  })

  it('rethrows directory errors other than missing paths', async () => {
    const root = await makeProject()
    await writeFile(resolve(root, 'src'), 'not a directory')

    await expect(readSourceFiles(root)).rejects.toThrow(/directory/i)
  })

  it('treats only real ENOENT errors as missing directories', async () => {
    vi.resetModules()
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof import('node:fs/promises')>(
          'node:fs/promises'
        )
      return {
        ...actual,
        readdir: vi
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error('boom'), { code: 'ENOENT' })
          )
          .mockRejectedValueOnce(new Error('boom'))
          .mockRejectedValueOnce({ code: 'ENOENT' })
      }
    })

    const { readSourceFiles: readWithMock } =
      await import('./project-analysis-files.js')
    const root = await makeProject()

    await expect(readWithMock(root)).resolves.toEqual([])
    await expect(readWithMock(root)).rejects.toThrow('boom')
    await expect(readWithMock(root)).rejects.toEqual({ code: 'ENOENT' })

    vi.doUnmock('node:fs/promises')
    vi.resetModules()
  })
})

async function makeProject(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-project-files-'))
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

function scriptKind(
  file: ReturnType<typeof readSourceFiles> extends Promise<infer Files>
    ? Files extends readonly (infer File)[]
      ? File | undefined
      : never
    : never
): ts.ScriptKind | undefined {
  const source = file?.source as ts.SourceFile & { scriptKind?: ts.ScriptKind }
  return source.scriptKind
}
