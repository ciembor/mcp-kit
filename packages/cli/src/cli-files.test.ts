import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  applyPlan,
  createOrMergeOperation,
  detectLanguage,
  detectPackageManager,
  detectProjectContext,
  detectProjectRoot,
  exists,
  findTemplateDirectory,
  readJsonFile,
  safeReaddir
} from './cli-files.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('cli file helpers', () => {
  it('creates merge operations for package, json, yaml and conflicts', async () => {
    const cwd = await makeTemp()
    await writeFile(resolve(cwd, 'package.json'), '{"scripts":{"keep":"keep"}}')
    await writeFile(resolve(cwd, 'config.json'), '{"a":{"b":1}}')
    await writeFile(resolve(cwd, 'ci.yaml'), 'name: old\n')
    await writeFile(resolve(cwd, 'text.txt'), 'old\n')

    const packageMerge = await createOrMergeOperation(
      cwd,
      'package.json',
      '{"scripts":{"start":"node index.js"},"dependencies":{"x":"1"}}'
    )
    expect(packageMerge.kind).toBe('merge-package')
    expect(packageMerge.content).toContain('"start": "node index.js"')

    const jsonMerge = await createOrMergeOperation(
      cwd,
      'config.json',
      '{"a":{"c":2}}'
    )
    expect(jsonMerge.kind).toBe('merge-json')
    expect(jsonMerge.content).toContain('"c": 2')

    const yamlMerge = await createOrMergeOperation(
      cwd,
      'ci.yaml',
      'name: new\n'
    )
    expect(yamlMerge.kind).toBe('merge-yaml')
    expect(yamlMerge.content).toContain('>>>>>>> mcp-kit')

    await expect(
      createOrMergeOperation(cwd, 'ci.yaml', 'name: old\n')
    ).resolves.toMatchObject({
      kind: 'create',
      content: 'name: old\n'
    })

    const conflict = await createOrMergeOperation(cwd, 'text.txt', 'new\n')
    expect(conflict.kind).toBe('conflict')
    expect(conflict.path).toBe('text.txt.mcp-kit.conflict')
    expect(conflict.content).toContain('<<<<<<< existing')
  })

  it('rolls back partially applied plans', async () => {
    const cwd = await makeTemp()
    await writeFile(resolve(cwd, 'blocker'), 'not a directory')
    await writeFile(resolve(cwd, 'existing.txt'), 'before')

    await expect(
      applyPlan(
        {
          root: cwd,
          operations: [
            { kind: 'create', path: 'noop.txt' },
            { kind: 'create', path: 'created.txt', content: 'created' },
            { kind: 'create', path: 'blocker/file.txt', content: 'fail' }
          ]
        },
        { allowOverwrite: false }
      )
    ).rejects.toThrow()
    await expect(
      readFile(resolve(cwd, 'created.txt'), 'utf8')
    ).rejects.toThrow()

    await expect(
      applyPlan(
        {
          root: cwd,
          operations: [
            { kind: 'overwrite', path: 'existing.txt', content: 'after' },
            { kind: 'create', path: 'blocker/again.txt', content: 'fail' }
          ]
        },
        { allowOverwrite: true }
      )
    ).rejects.toThrow()
    await expect(readFile(resolve(cwd, 'existing.txt'), 'utf8')).resolves.toBe(
      'before'
    )
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
