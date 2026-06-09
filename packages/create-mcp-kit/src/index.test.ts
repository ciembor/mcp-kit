import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from './bin.js'
import { createMcpKitProject, internals, runCreateMcpKit } from './index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  process.exitCode = undefined
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('create-mcp-kit', () => {
  it('generates the official feature-first project', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    temporaryDirectories.push(cwd)

    const target = await createMcpKitProject('My Server', { cwd })
    const packageJson = JSON.parse(
      await readFile(resolve(target, 'package.json'), 'utf8')
    ) as { name: string }

    expect(packageJson.name).toBe('my-server')
    await expect(
      readFile(
        resolve(target, 'src/features/health/application/get-health.ts'),
        'utf8'
      )
    ).resolves.toContain('getHealth')
    await expect(
      readFile(resolve(target, 'src/mcp/registry.ts'), 'utf8')
    ).resolves.toContain('defineRegistry')
  })

  it('does not overwrite a non-empty directory', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    temporaryDirectories.push(cwd)
    const target = resolve(cwd, 'existing')
    await createMcpKitProject('existing', { cwd })
    await writeFile(resolve(target, 'owned-by-user.txt'), 'keep')

    await expect(createMcpKitProject('existing', { cwd })).rejects.toThrow(
      'Target directory is not empty'
    )
  })

  it('allows an existing empty directory', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    temporaryDirectories.push(cwd)

    const target = resolve(cwd, 'empty-target')
    await mkdir(target)

    await expect(createMcpKitProject('empty-target', { cwd })).resolves.toBe(
      target
    )
  })

  it('validates project path and existing file targets', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    temporaryDirectories.push(cwd)
    await writeFile(resolve(cwd, 'file'), 'not a directory')

    await expect(createMcpKitProject('', { cwd })).rejects.toThrow(
      'Project directory is required'
    )
    await expect(createMcpKitProject('!!!', { cwd })).rejects.toThrow(
      'Cannot derive a package name'
    )
    await expect(createMcpKitProject('file', { cwd })).rejects.toThrow(
      'Target exists and is not a directory'
    )
  })

  it('uses explicit dependency specs and nested template token replacement', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    temporaryDirectories.push(cwd)

    const target = await createMcpKitProject('server', {
      cwd,
      corePackage: 'workspace:core',
      nodePackage: 'workspace:node',
      cliPackage: 'workspace:cli',
      testingPackage: 'workspace:testing'
    })

    await expect(
      readFile(resolve(target, 'package.json'), 'utf8')
    ).resolves.toContain('"@mcp-kit/core": "workspace:core"')
    await expect(
      readFile(resolve(target, 'package.json'), 'utf8')
    ).resolves.toContain('"@mcp-kit/node": "workspace:node"')
    await expect(
      readFile(resolve(target, 'package.json'), 'utf8')
    ).resolves.toContain('"@mcp-kit/cli": "workspace:cli"')
    await expect(
      readFile(resolve(target, 'package.json'), 'utf8')
    ).resolves.toContain('"@mcp-kit/testing": "workspace:testing"')
    await expect(
      readFile(resolve(target, 'src/app.ts'), 'utf8')
    ).resolves.toContain("name: 'server'")
  })

  it('returns CLI status codes and writes messages', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    temporaryDirectories.push(cwd)
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)

    await expect(runCreateMcpKit([])).resolves.toBe(1)
    await expect(runCreateMcpKit(['server'])).resolves.toBe(0)
    await expect(runCreateMcpKit(['server'])).resolves.toBe(1)
    await main(['second'])

    expect(process.exitCode).toBe(0)
    expect(write).toHaveBeenCalled()
    cwdSpy.mockRestore()
    write.mockRestore()
  })

  it('reports missing bundled templates', async () => {
    await expect(
      internals.findTemplateDirectory(['/definitely/missing'])
    ).rejects.toThrow('Bundled project template was not found')
    await expect(internals.findTemplateDirectory(['\0'])).rejects.toThrow()
    expect(internals.errorMessage(new Error('typed'))).toBe('typed')
    expect(internals.errorMessage('raw')).toBe('raw')
    expect(internals.toPackageName('---Server---')).toBe('server')
  })
})
