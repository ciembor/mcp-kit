import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  checkNpmPack,
  checkPackageExports,
  checkPackageFiles,
  checkVersions
} from './release-checks-package-validations.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release package validations extra coverage', () => {
  it('fails version checks when the root package is missing or invalid', async () => {
    const root = await mkdtemp(
      resolve(tmpdir(), 'mcp-kit-release-validations-')
    )
    temporaryDirectories.push(root)
    await mkdir(resolve(root, 'packages/core'), { recursive: true })

    await expect(checkVersions(root)).resolves.toEqual([
      expect.objectContaining({
        file: 'package.json',
        message: 'package.json is missing or invalid'
      })
    ])

    await writeFile(
      resolve(root, 'package.json'),
      JSON.stringify({ name: 'repo', version: 1 })
    )
    await writeFile(
      resolve(root, 'packages/core/package.json'),
      JSON.stringify({
        name: '@mcp-kit/core',
        version: 'workspace:*'
      })
    )
    await expect(checkVersions(root)).resolves.toEqual([
      expect.objectContaining({
        message:
          'Root package version must be a concrete semver value, received "1"'
      }),
      expect.objectContaining({
        message:
          'Package @mcp-kit/core must declare a concrete semver version, received "workspace:*"'
      })
    ])
  })

  it('covers package export validation branches', async () => {
    const root = await makeWorkspace()

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: undefined,
      files: ['dist', 'README.md']
    })
    await expect(checkPackageExports(root)).resolves.toEqual([
      expect.objectContaining({
        message: 'Package @mcp-kit/core must define an exports map'
      })
    ])

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {},
      files: ['dist', 'README.md']
    })
    await expect(checkPackageExports(root)).resolves.toEqual([
      expect.objectContaining({
        message:
          'Package @mcp-kit/core must define a root "." export with import and types'
      })
    ])

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {
        '.': {
          import: './dist/index.js'
        }
      },
      files: ['dist', 'README.md']
    })
    await expect(checkPackageExports(root)).resolves.toEqual([
      expect.objectContaining({
        message:
          'Package @mcp-kit/core root export must define string import and types targets'
      })
    ])

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts'
        }
      },
      files: ['dist']
    })
    await expect(checkPackageFiles(root)).resolves.toEqual([
      expect.objectContaining({
        message: 'Package @mcp-kit/core files must include README.md'
      })
    ])

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts'
        }
      },
      bin: {
        cli: './bin.js'
      },
      files: ['dist', 'README.md']
    })
    await expect(checkPackageExports(root)).resolves.toEqual([
      expect.objectContaining({
        message:
          'Package @mcp-kit/core bin target ./bin.js must stay under ./dist/'
      })
    ])
  })

  it('covers package files and npm pack validation branches', async () => {
    const root = await makeWorkspace()

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts'
        }
      },
      files: ['dist', 1]
    })
    await expect(checkPackageFiles(root)).resolves.toEqual([
      expect.objectContaining({
        message: 'Package @mcp-kit/core must define a files array'
      })
    ])

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts'
        }
      },
      files: ['README.md']
    })
    await expect(checkPackageFiles(root)).resolves.toEqual([
      expect.objectContaining({
        message: 'Package @mcp-kit/core files must include dist/index.js'
      }),
      expect.objectContaining({
        message: 'Package @mcp-kit/core files must include dist/index.d.ts'
      })
    ])

    await writeWorkspacePackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts'
        }
      },
      files: ['dist', 'README.md']
    })

    await expect(
      checkNpmPack(root, new AbortController().signal, () =>
        Promise.resolve({
          exitCode: 0,
          stdout: 'invalid json',
          stderr: ''
        })
      )
    ).resolves.toEqual([
      expect.objectContaining({
        message: 'npm pack must return JSON output for @mcp-kit/core'
      })
    ])

    await expect(
      checkNpmPack(root, new AbortController().signal, () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '[]',
          stderr: ''
        })
      )
    ).resolves.toEqual([
      expect.objectContaining({
        message:
          'npm pack must report at least one packed artifact for @mcp-kit/core'
      })
    ])

    await expect(
      checkNpmPack(root, new AbortController().signal, () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '[{"filename":"core.tgz"}]',
          stderr: ''
        })
      )
    ).resolves.toEqual([])

    await expect(
      checkNpmPack(root, new AbortController().signal, undefined)
    ).resolves.toEqual([])
  })
})

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-validations-'))
  temporaryDirectories.push(root)
  await mkdir(resolve(root, 'packages/core/src'), { recursive: true })
  await mkdir(resolve(root, 'packages/core/dist'), { recursive: true })
  await writeFile(
    resolve(root, 'package.json'),
    JSON.stringify({ name: 'repo', version: '1.2.3' })
  )
  await writeFile(
    resolve(root, 'packages/core/src/index.ts'),
    "export const packageInfo = { name: '@mcp-kit/core', version: '1.2.3' }\n"
  )
  await writeFile(resolve(root, 'packages/core/dist/index.js'), 'export {}\n')
  await writeFile(
    resolve(root, 'packages/core/dist/index.d.ts'),
    'export declare const packageInfo: unknown\n'
  )
  await writeFile(resolve(root, 'packages/core/README.md'), '# readme\n')
  return root
}

async function writeWorkspacePackage(
  root: string,
  directory: string,
  manifest: Record<string, unknown>
): Promise<void> {
  await writeFile(
    resolve(root, 'packages', directory, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
}
