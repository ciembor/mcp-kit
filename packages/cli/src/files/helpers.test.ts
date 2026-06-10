import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  exists,
  findTemplateDirectory,
  readJsonFile,
  safeReaddir
} from './helpers.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('filesystem helpers', () => {
  it('covers safe filesystem reads, json helpers and template discovery', async () => {
    const cwd = await makeTemp()
    await writeFile(resolve(cwd, 'file'), 'x')

    await expect(safeReaddir(resolve(cwd, 'missing'))).resolves.toEqual([])
    await expect(safeReaddir(resolve(cwd, 'file/child'))).rejects.toThrow()
    await expect(exists(resolve(cwd, 'missing'))).resolves.toBe(false)
    await expect(exists(resolve(cwd, 'file/child'))).rejects.toThrow()
    await expect(
      readJsonFile(resolve(cwd, 'missing.json'))
    ).resolves.toBeUndefined()
    await writeFile(resolve(cwd, 'bad.json'), '{bad')
    await expect(
      readJsonFile(resolve(cwd, 'bad.json'))
    ).resolves.toBeUndefined()
    await expect(findTemplateDirectory()).resolves.toContain(
      'templates/default'
    )
    await expect(
      findTemplateDirectory([resolve(cwd, 'missing-template')])
    ).rejects.toThrow('Bundled project template was not found')
    await expect(findTemplateDirectory(['\0'])).rejects.toThrow()
  })
})

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'mcp-kit-cli-files-'))
  temporaryDirectories.push(directory)
  return directory
}
