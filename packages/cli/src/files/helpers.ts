import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { exitCodes, type JsonValue } from '../cli-contracts.js'
import { CliError } from '../cli-error.js'
import { isNodeErrorCode } from '../cli-utils.js'

export async function findTemplateDirectory(
  candidates: readonly string[] = [
    fileURLToPath(new URL('../template', import.meta.url)),
    fileURLToPath(new URL('../../../../templates/default', import.meta.url))
  ]
): Promise<string> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) continue
      throw error
    }
  }
  throw new CliError(
    'Bundled project template was not found',
    exitCodes.internal
  )
}

export async function readTemplateFiles(
  directory: string,
  prefix = ''
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readTemplateFiles(absolute, path)))
    } else {
      files.push({ path, content: await readFile(absolute, 'utf8') })
    }
  }
  return files
}

export async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

export async function readJsonFile(
  path: string
): Promise<JsonValue | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as JsonValue
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined
    return undefined
  }
}
