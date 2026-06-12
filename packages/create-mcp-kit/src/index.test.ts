import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from './bin.js'
import { runCreateMcpKit } from './app/run-create-mcp-kit.js'
import { createMcpKitProject } from './index.js'
import { findTemplateDirectory } from './scaffold/template-directory.js'
import { errorMessage } from './shared/error-message.js'
import { toPackageName } from './shared/package-name.js'

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

  it('rejects path traversal outside the working directory', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    temporaryDirectories.push(cwd)

    await expect(createMcpKitProject('../escape', { cwd })).rejects.toThrow(
      'Target must stay within the working directory'
    )
  })

  it('rejects target paths that traverse symbolic links', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    const external = await mkdtemp(
      resolve(tmpdir(), 'create-mcp-kit-external-')
    )
    temporaryDirectories.push(cwd, external)

    await symlink(external, resolve(cwd, 'linked'))

    await expect(createMcpKitProject('linked/server', { cwd })).rejects.toThrow(
      'Target must not traverse symbolic links'
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

  it('restores bundled template test filenames when copying from a bundled template', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-'))
    const template = await mkdtemp(resolve(tmpdir(), 'create-mcp-kit-template-'))
    temporaryDirectories.push(cwd, template)

    await mkdir(resolve(template, 'test/contracts'), { recursive: true })
    await writeFile(
      resolve(template, 'package.json'),
      '{"name":"{{packageName}}","version":"0.0.0"}\n'
    )
    await writeFile(
      resolve(template, 'test/contracts/health.contract.test.template.ts'),
      'export {}\n'
    )

    const target = await createMcpKitProject('server', {
      cwd,
      templateDirectory: template
    })

    await expect(
      readFile(
        resolve(target, 'test/contracts/health.contract.test.ts'),
        'utf8'
      )
    ).resolves.toContain('export {}')
    await expect(
      readFile(
        resolve(target, 'test/contracts/health.contract.test.template.ts'),
        'utf8'
      )
    ).rejects.toThrow()
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
      findTemplateDirectory(['/definitely/missing'])
    ).rejects.toThrow('Bundled project template was not found')
    await expect(findTemplateDirectory(['\0'])).rejects.toThrow()
    expect(errorMessage(new Error('typed'))).toBe('typed')
    expect(errorMessage('raw')).toBe('raw')
    expect(toPackageName('---Server---')).toBe('server')
  })
})
