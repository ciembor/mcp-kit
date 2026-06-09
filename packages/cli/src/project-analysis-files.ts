import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

import type { SourceFile } from './project-analysis-types.js'
import { normalizePath } from './project-analysis-helpers.js'

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export async function readSourceFiles(
  root: string,
  directory = 'src'
): Promise<SourceFile[]> {
  const base = resolve(root, directory)
  const files: SourceFile[] = []

  async function visit(path: string): Promise<void> {
    let entries
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) return
      throw error
    }
    for (const entry of entries) {
      const absolute = join(path, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!sourceExtensions.has(extname(entry.name))) continue
      const content = await readFile(absolute, 'utf8')
      files.push({
        path: normalizePath(relative(root, absolute)),
        absolute,
        source: ts.createSourceFile(
          absolute,
          content,
          ts.ScriptTarget.Latest,
          true,
          scriptKind(absolute)
        )
      })
    }
  }

  await visit(base)
  return files
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
