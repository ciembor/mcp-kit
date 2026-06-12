import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  packReleasePackagesMock,
  releasePackageManifestsMock,
  runNpmInstallMock,
  runCommandMock
} = vi.hoisted(() => ({
  packReleasePackagesMock: vi.fn(),
  releasePackageManifestsMock: vi.fn(),
  runNpmInstallMock: vi.fn(),
  runCommandMock: vi.fn()
}))

vi.mock('./release-checks-packaging.js', () => ({
  packReleasePackages: packReleasePackagesMock
}))

vi.mock('./release-checks-manifests.js', async () => {
  const actual = await vi.importActual<
    typeof import('./release-checks-manifests.js')
  >('./release-checks-manifests.js')
  return {
    ...actual,
    releasePackageManifests: releasePackageManifestsMock
  }
})

vi.mock('./release-checks-support.js', async () => {
  const actual = await vi.importActual<
    typeof import('./release-checks-support.js')
  >('./release-checks-support.js')
  return {
    ...actual,
    runNpmInstall: runNpmInstallMock,
    runCommand: runCommandMock
  }
})

import {
  cleanupPreparedRelease,
  prepareInstalledReleasePackages,
  runInstalledCliSmoke,
  runInstalledImportSmoke,
  runInstalledTypeSmoke
} from './release-checks-install.js'

const temporaryDirectories: string[] = []

beforeEach(() => {
  packReleasePackagesMock.mockReset()
  releasePackageManifestsMock.mockReset()
  runNpmInstallMock.mockReset()
  runCommandMock.mockReset()
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release check install helpers', () => {
  it('returns pack diagnostics without installing anything', async () => {
    const root = await makeWorkspace()
    releasePackageManifestsMock.mockResolvedValue([])
    packReleasePackagesMock.mockResolvedValue({
      tarballs: [],
      diagnostics: [{ rule: 'r', file: 'f', message: 'm' }]
    })

    const prepared = await prepareInstalledReleasePackages(
      root,
      new AbortController().signal
    )

    expect(prepared).toMatchObject({
      diagnostics: [{ rule: 'r', file: 'f', message: 'm' }]
    })
  })

  it('uses the provided npm install override and populates synthetic node_modules', async () => {
    const root = await makeWorkspace()
    const manifest = await createPackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      files: ['dist', 'README.md']
    })
    releasePackageManifestsMock.mockResolvedValue([manifest])
    packReleasePackagesMock.mockResolvedValue({
      tarballs: ['core.tgz'],
      diagnostics: []
    })

    const npmInstall = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: ''
    }))

    const prepared = await prepareInstalledReleasePackages(
      root,
      new AbortController().signal,
      { npmInstall }
    )

    expect(npmInstall).toHaveBeenCalledWith(
      expect.stringContaining('install'),
      [],
      expect.any(AbortSignal)
    )
    if (!('installDirectory' in prepared)) {
      throw new Error('expected install directory')
    }
    await expect(
      readFile(
        resolve(
          prepared.installDirectory,
          'node_modules',
          '@mcp-kit/core',
          'package.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"name": "@mcp-kit/core"')
    await cleanupPreparedRelease(prepared)
  })

  it('reports install failures from the provided npm install override', async () => {
    const root = await makeWorkspace()
    const manifest = await createPackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      files: ['dist', 'README.md']
    })
    releasePackageManifestsMock.mockResolvedValue([manifest])
    packReleasePackagesMock.mockResolvedValue({
      tarballs: ['core.tgz'],
      diagnostics: []
    })

    const prepared = await prepareInstalledReleasePackages(
      root,
      new AbortController().signal,
      {
        npmInstall: async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'install failed'
        })
      }
    )

    expect(prepared).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          file: 'package.json',
          message:
            'npm install failed for packed release tarballs: install failed'
        })
      ]
    })
  })

  it('uses the default npm install helper when no override is provided', async () => {
    const root = await makeWorkspace()
    const manifest = await createPackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      files: ['dist', 'README.md']
    })
    releasePackageManifestsMock.mockResolvedValue([manifest])
    packReleasePackagesMock.mockResolvedValue({
      tarballs: ['core.tgz'],
      diagnostics: []
    })
    runNpmInstallMock.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })

    const prepared = await prepareInstalledReleasePackages(
      root,
      new AbortController().signal
    )

    expect(runNpmInstallMock).toHaveBeenCalledWith(
      expect.stringContaining('install'),
      ['core.tgz'],
      expect.any(AbortSignal)
    )
    if (!('installDirectory' in prepared)) {
      throw new Error('expected install directory')
    }
    await cleanupPreparedRelease(prepared)
    await expect(readFile(resolve(prepared.tempRoot, 'package.json'), 'utf8')).rejects.toThrow()
  })

  it('reports install failures from the default npm install helper', async () => {
    const root = await makeWorkspace()
    const manifest = await createPackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      files: ['dist', 'README.md']
    })
    releasePackageManifestsMock.mockResolvedValue([manifest])
    packReleasePackagesMock.mockResolvedValue({
      tarballs: ['core.tgz'],
      diagnostics: []
    })
    runNpmInstallMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'default install failed'
    })

    const prepared = await prepareInstalledReleasePackages(
      root,
      new AbortController().signal
    )

    expect(prepared).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          message:
            'npm install failed for packed release tarballs: default install failed'
        })
      ]
    })
  })

  it('runs import, type, and cli smoke checks and maps failures', async () => {
    const manifest = {
      name: '@mcp-kit/core',
      version: '1.2.3',
      path: 'packages/core/package.json',
      directory: 'packages/core',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts'
        }
      },
      bin: { cli: './dist/bin.js' }
    }
    const installDirectory = await mkdtemp(
      resolve(tmpdir(), 'mcp-kit-release-install-smoke-')
    )
    temporaryDirectories.push(installDirectory)

    await expect(
      runInstalledImportSmoke(
        installDirectory,
        [],
        new AbortController().signal
      )
    ).resolves.toEqual([])
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'import failed'
    })
    await expect(
      runInstalledImportSmoke(
        installDirectory,
        [manifest],
        new AbortController().signal
      )
    ).resolves.toEqual([
      expect.objectContaining({
        file: 'imports.mjs',
        message: 'Installed package imports failed: import failed'
      })
    ])

    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(
      runInstalledImportSmoke(
        installDirectory,
        [manifest],
        new AbortController().signal
      )
    ).resolves.toEqual([])

    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'type output',
      stderr: ''
    })
    await expect(
      runInstalledTypeSmoke(
        installDirectory,
        [manifest],
        new AbortController().signal
      )
    ).resolves.toEqual([
      expect.objectContaining({
        file: 'types-smoke.ts',
        message: 'Installed package types failed: type output'
      })
    ])

    await expect(
      runInstalledTypeSmoke(
        installDirectory,
        [],
        new AbortController().signal
      )
    ).resolves.toEqual([])

    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(
      runInstalledTypeSmoke(
        installDirectory,
        [manifest],
        new AbortController().signal
      )
    ).resolves.toEqual([])

    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'cli failed',
      stderr: ''
    })
    await expect(
      runInstalledCliSmoke(
        installDirectory,
        [manifest],
        new AbortController().signal
      )
    ).resolves.toEqual([
      expect.objectContaining({
        file: 'packages/core/package.json',
        message: 'Installed CLI smoke failed for @mcp-kit/core: cli failed'
      })
    ])

    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(
      runInstalledCliSmoke(
        installDirectory,
        [manifest],
        new AbortController().signal
      )
    ).resolves.toEqual([])
  })
})

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-install-'))
  temporaryDirectories.push(root)
  await mkdir(resolve(root, 'packages'), { recursive: true })
  return root
}

async function createPackage(
  root: string,
  directory: string,
  packageJson: Record<string, unknown>
) {
  const packageRoot = resolve(root, 'packages', directory)
  await mkdir(resolve(packageRoot, 'dist'), { recursive: true })
  await writeFile(resolve(packageRoot, 'dist/index.js'), 'export {}\n')
  await writeFile(resolve(packageRoot, 'dist/index.d.ts'), 'export declare const x: number\n')
  await writeFile(resolve(packageRoot, 'dist/bin.js'), 'console.log("help")\n')
  await writeFile(resolve(packageRoot, 'README.md'), '# readme\n')
  await writeFile(
    resolve(packageRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
  return {
    name: String(packageJson.name),
    version: String(packageJson.version),
    path: `packages/${directory}/package.json`,
    directory: `packages/${directory}`,
    files: packageJson.files,
    exports: {
      '.': {
        import: './dist/index.js',
        types: './dist/index.d.ts'
      }
    },
    bin: {
      cli: './dist/bin.js'
    }
  }
}
