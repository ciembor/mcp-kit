import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  binTargets,
  coversPublishedPath,
  displayValue,
  exportSpecifiers,
  exportTargets,
  isSemver,
  normalizePublishPath,
  packageInfoDiagnostics,
  packageVersion,
  readPackageManifest,
  releasePackageManifests
} from './release-checks-manifests.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release check manifests', () => {
  it('reads workspace package manifests and filters private or invalid packages', async () => {
    const root = await makeWorkspace()
    await writeJson(resolve(root, 'packages/core/package.json'), {
      name: '@mcp-kit/core',
      version: '1.2.3',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts'
        }
      }
    })
    await writeJson(resolve(root, 'packages/private/package.json'), {
      name: '@mcp-kit/private',
      version: '1.2.3',
      private: true
    })
    await writeJson(resolve(root, 'packages/invalid/package.json'), {
      name: '@mcp-kit/invalid',
      version: 1
    })
    await writeJson(resolve(root, 'packages/no-name/package.json'), {
      name: 1,
      version: '1.2.3'
    })

    await expect(releasePackageManifests(root)).resolves.toEqual([
      {
        name: '@mcp-kit/core',
        version: '1.2.3',
        private: false,
        path: 'packages/core/package.json',
        directory: 'packages/core',
        exports: {
          '.': {
            import: './dist/index.js',
            types: './dist/index.d.ts'
          }
        },
        bin: undefined,
        files: undefined
      }
    ])

    await expect(releasePackageManifests(resolve(root, 'missing-root'))).resolves.toEqual([])
  })

  it('returns undefined for invalid manifests and diagnoses packageInfo issues', async () => {
    const root = await makeWorkspace()
    const packageJsonPath = resolve(root, 'packages/core/package.json')
    await writeJson(packageJsonPath, {
      name: '@mcp-kit/core',
      version: '1.2.3'
    })

    await expect(readPackageManifest(packageJsonPath)).resolves.toEqual({
      name: '@mcp-kit/core',
      version: '1.2.3'
    })

    await writeFile(packageJsonPath, '[]')
    await expect(readPackageManifest(packageJsonPath)).resolves.toBeUndefined()

    await writeFile(packageJsonPath, '{invalid json')
    await expect(readPackageManifest(packageJsonPath)).resolves.toBeUndefined()

    const manifest = {
      name: '@mcp-kit/core',
      version: '1.2.3',
      path: 'packages/core/package.json',
      directory: 'packages/core'
    }

    await expect(packageInfoDiagnostics(root, manifest)).resolves.toEqual([
      expect.objectContaining({
        rule: 'release-version',
        file: 'packages/core/package.json'
      })
    ])

    await mkdir(resolve(root, 'packages/core/src'), { recursive: true })
    await writeFile(
      resolve(root, 'packages/core/src/index.ts'),
      "export const packageInfo = computedValue()\n"
    )
    await expect(packageInfoDiagnostics(root, manifest)).resolves.toEqual([
      expect.objectContaining({
        file: 'packages/core/src/index.ts',
        message: 'packageInfo must declare literal name and version fields'
      })
    ])

    await writeFile(
      resolve(root, 'packages/core/src/index.ts'),
      "export const packageInfo = { name: '@mcp-kit/other', version: '9.9.9' }\n"
    )
    await expect(packageInfoDiagnostics(root, manifest)).resolves.toEqual([
      expect.objectContaining({
        message:
          'packageInfo name @mcp-kit/other must match package.json name @mcp-kit/core'
      }),
      expect.objectContaining({
        message:
          'packageInfo version 9.9.9 must match package.json version 1.2.3'
      })
    ])

    await writeFile(
      resolve(root, 'packages/core/src/index.ts'),
      "export const packageInfo = { name: '@mcp-kit/core', version: '1.2.3' }\n"
    )
    await expect(packageInfoDiagnostics(root, manifest)).resolves.toEqual([])

    await writeFile(resolve(root, 'packages/core/src/notes.txt'), 'ignored\n')
    await writeFile(
      resolve(root, 'packages/core/src/helper.ts'),
      'export const helper = true\n'
    )
    await rm(resolve(root, 'packages/core/src/index.ts'))
    await expect(packageInfoDiagnostics(root, manifest)).resolves.toEqual([
      expect.objectContaining({
        message:
          'Package @mcp-kit/core must export packageInfo with name and version'
      })
    ])

    await mkdir(resolve(root, 'packages/core/src/nested/deeper'), {
      recursive: true
    })
    await mkdir(resolve(root, 'packages/core/src/empty-dir'), {
      recursive: true
    })
    await writeFile(
      resolve(root, 'packages/core/src/nested/deeper/index.js'),
      "export const packageInfo = { name: '@mcp-kit/core', version: '1.2.3' }\n"
    )
    await expect(packageInfoDiagnostics(root, manifest)).resolves.toEqual([])
  })

  it('normalizes exported targets and utility predicates', () => {
    expect(packageVersion('1.2.3')).toBe('1.2.3')
    expect(packageVersion(1)).toBeUndefined()
    expect(displayValue('1.2.3')).toBe('1.2.3')
    expect(displayValue({ ok: true })).toBe('{"ok":true}')
    expect(displayValue(undefined)).toBe('undefined')
    expect(exportTargets(['./dist/index.js', { nested: './dist/cli.js' }])).toEqual([
      './dist/index.js',
      './dist/cli.js'
    ])
    expect(exportTargets(123)).toEqual([])
    expect(binTargets([undefined, { cli: './dist/bin.js' }])).toEqual([
      './dist/bin.js'
    ])
    expect(binTargets({ cli: './dist/bin.js' })).toEqual(['./dist/bin.js'])
    expect(
      exportSpecifiers({
        name: '@mcp-kit/core',
        version: '1.2.3',
        path: 'packages/core/package.json',
        directory: 'packages/core',
        exports: {
          '.': { import: './dist/index.js' },
          './cli': { import: './dist/cli.js' },
          invalid: { import: './dist/skip.js' }
        }
      })
    ).toEqual(['@mcp-kit/core', '@mcp-kit/core/cli'])
    expect(
      exportSpecifiers({
        name: '@mcp-kit/core',
        version: '1.2.3',
        path: 'packages/core/package.json',
        directory: 'packages/core',
        exports: undefined
      })
    ).toEqual(['@mcp-kit/core'])
    expect(normalizePublishPath('./dist/index.js')).toBe('dist/index.js')
    expect(normalizePublishPath('README.md')).toBe('README.md')
    expect(coversPublishedPath('dist', 'dist/index.js')).toBe(true)
    expect(coversPublishedPath('dist/', 'dist/index.js')).toBe(true)
    expect(coversPublishedPath('README.md', 'dist/index.js')).toBe(false)
    expect(isSemver('1.2.3')).toBe(true)
    expect(isSemver('1.2.3-beta.1+build')).toBe(true)
    expect(isSemver('workspace:*')).toBe(false)
  })
})

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-manifests-'))
  temporaryDirectories.push(root)
  await mkdir(resolve(root, 'packages/core'), { recursive: true })
  await mkdir(resolve(root, 'packages/private'), { recursive: true })
  await mkdir(resolve(root, 'packages/invalid'), { recursive: true })
  return root
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
