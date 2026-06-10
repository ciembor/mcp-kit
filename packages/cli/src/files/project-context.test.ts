import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertSafeNewTarget,
  detectLanguage,
  detectPackageManager,
  detectProjectContext,
  detectProjectRoot
} from './project-context.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('project context', () => {
  it('rejects unsafe new targets', async () => {
    const cwd = await makeTemp()
    const fileTarget = resolve(cwd, 'file-target')
    const directoryTarget = resolve(cwd, 'directory-target')

    await writeFile(fileTarget, 'x')
    await mkdir(directoryTarget, { recursive: true })
    await writeFile(resolve(directoryTarget, 'package.json'), '{}')

    await expect(
      assertSafeNewTarget(resolve(cwd, 'missing'), false)
    ).resolves.toBeUndefined()
    await expect(assertSafeNewTarget(fileTarget, false)).rejects.toThrow(
      'Target exists and is not a directory'
    )
    await expect(assertSafeNewTarget(directoryTarget, false)).rejects.toThrow(
      'Target directory is not empty'
    )
    await expect(
      assertSafeNewTarget(directoryTarget, true)
    ).resolves.toBeUndefined()
  })

  it('detects package manager, language, project roots and context', async () => {
    const cwd = await makeTemp()
    const nested = resolve(cwd, 'a/b')
    await mkdir(resolve(cwd, '.git'), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(resolve(cwd, 'yarn.lock'), '')

    await expect(detectProjectRoot(nested, false)).resolves.toBe(cwd)
    await expect(detectProjectRoot(nested, true)).resolves.toBe(nested)
    expect(detectPackageManager(cwd)).toBe('yarn')
    await rm(resolve(cwd, 'yarn.lock'))
    await writeFile(resolve(cwd, 'package-lock.json'), '')
    expect(detectPackageManager(cwd)).toBe('npm')
    await writeFile(
      resolve(cwd, 'package.json'),
      '{"devDependencies":{"typescript":"5"}}'
    )
    expect(await detectLanguage(cwd)).toBe('typescript')
    await expect(detectProjectContext(cwd)).resolves.toMatchObject({
      root: cwd,
      gitRoot: cwd
    })
  })
})

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'mcp-kit-cli-files-'))
  temporaryDirectories.push(directory)
  return directory
}
