import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { packReleasePackages } from './release-checks-packaging.js'
import type { WorkspacePackageManifest } from './release-checks-manifests.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release check packaging helpers', () => {
  it('rewrites workspace dependency ranges before packing', async () => {
    const root = await makeWorkspace()
    const manifest = await createPackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      files: ['dist', 'README.md'],
      dependencies: {
        a: 'workspace:*',
        b: 'workspace:^',
        c: 'workspace:~',
        d: 'workspace:9.9.9',
        e: 'workspace:next',
        f: '^1.0.0'
      }
    })
    const dependencyManifests = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        createPackage(root, name, {
          name,
          version: '1.2.3',
          files: ['dist', 'README.md']
        })
      )
    )

    const stagingDirectory = resolve(root, 'staging')
    const tarballDirectory = resolve(root, 'tarballs')
    const seenManifest: Array<Record<string, unknown>> = []

    const result = await packReleasePackages({
      root,
      manifests: [manifest, ...dependencyManifests],
      stagingDirectory,
      tarballDirectory,
      signal: new AbortController().signal,
      npmPack: async (packageRoot) => {
        const stagedManifest = JSON.parse(
          await readFile(resolve(packageRoot, 'package.json'), 'utf8')
        ) as Record<string, unknown>
        seenManifest.push(stagedManifest)
        return {
          exitCode: 0,
          stdout: '[{"filename":"core.tgz"}]',
          stderr: ''
        }
      }
    })

    expect(result.diagnostics).toEqual([])
    expect(result.tarballs).toHaveLength(6)
    expect(seenManifest[0]).toEqual(
      expect.objectContaining({
        dependencies: {
          a: '1.2.3',
          b: '^1.2.3',
          c: '~1.2.3',
          d: '9.9.9',
          e: '1.2.3',
          f: '^1.0.0'
        }
      })
    )
  })

  it('reports missing files arrays, copy failures, missing manifests, and unresolved workspace dependencies', async () => {
    const root = await makeWorkspace()
    const signal = new AbortController().signal
    const tarballDirectory = resolve(root, 'tarballs')
    const stagingDirectory = resolve(root, 'staging')

    const noFilesManifest = await createPackage(root, 'no-files', {
      name: '@mcp-kit/no-files',
      version: '1.2.3'
    })
    const noFiles = await packReleasePackages({
      root,
      manifests: [noFilesManifest],
      tarballDirectory,
      stagingDirectory,
      signal,
      npmPack: successfulPack
    })
    expect(noFiles.diagnostics).toEqual([
      expect.objectContaining({
        file: 'packages/no-files/package.json',
        message:
          'Package @mcp-kit/no-files must define a string files array before packing'
      })
    ])

    const missingFileManifest = await createPackage(root, 'missing-file', {
      name: '@mcp-kit/missing-file',
      version: '1.2.3',
      files: ['dist', 'README.md']
    })
    await rm(resolve(root, 'packages/missing-file/README.md'))
    const missingFile = await packReleasePackages({
      root,
      manifests: [missingFileManifest],
      tarballDirectory,
      stagingDirectory,
      signal,
      npmPack: successfulPack
    })
    expect(missingFile.diagnostics[0]).toMatchObject({
      file: 'packages/missing-file/package.json'
    })

    const missingManifest: WorkspacePackageManifest = {
      name: '@mcp-kit/missing-manifest',
      version: '1.2.3',
      path: 'packages/missing-manifest/package.json',
      directory: 'packages/missing-manifest',
      files: ['dist', 'README.md']
    }
    await mkdir(resolve(root, 'packages/missing-manifest/dist'), {
      recursive: true
    })
    await writeFile(resolve(root, 'packages/missing-manifest/README.md'), '# readme\n')
    const missingManifestResult = await packReleasePackages({
      root,
      manifests: [missingManifest],
      tarballDirectory,
      stagingDirectory,
      signal,
      npmPack: successfulPack
    })
    expect(missingManifestResult.diagnostics).toEqual([
      expect.objectContaining({
        file: 'packages/missing-manifest/package.json',
        message: 'package.json is missing or invalid'
      })
    ])

    const unresolvedManifest = await createPackage(root, 'unresolved', {
      name: '@mcp-kit/unresolved',
      version: '1.2.3',
      files: ['dist', 'README.md'],
      dependencies: {
        '@mcp-kit/missing': 'workspace:^'
      }
    })
    const unresolvedResult = await packReleasePackages({
      root,
      manifests: [unresolvedManifest],
      tarballDirectory,
      stagingDirectory,
      signal,
      npmPack: successfulPack
    })
    expect(unresolvedResult.diagnostics).toEqual([
      expect.objectContaining({
        file: 'packages/unresolved/package.json',
        message:
          'Cannot rewrite workspace dependency @mcp-kit/missing from workspace:^'
      })
    ])
  })

  it('reports npm pack failures and invalid npm pack output', async () => {
    const root = await makeWorkspace()
    const manifest = await createPackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      files: ['dist', 'README.md']
    })
    const baseArgs = {
      root,
      manifests: [manifest],
      tarballDirectory: resolve(root, 'tarballs'),
      stagingDirectory: resolve(root, 'staging'),
      signal: new AbortController().signal
    }

    const failed = await packReleasePackages({
      ...baseArgs,
      npmPack: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'pack failed'
      })
    })
    expect(failed.diagnostics).toEqual([
      expect.objectContaining({
        file: 'packages/core/package.json',
        message:
          'npm pack failed while preparing install tarballs: pack failed'
      })
    ])

    const invalidJson = await packReleasePackages({
      ...baseArgs,
      npmPack: async () => ({
        exitCode: 0,
        stdout: 'not json',
        stderr: ''
      })
    })
    expect(invalidJson.diagnostics).toEqual([
      expect.objectContaining({
        message: 'npm pack JSON output did not contain filenames'
      })
    ])

    const noFilenames = await packReleasePackages({
      ...baseArgs,
      npmPack: async () => ({
        exitCode: 0,
        stdout: '[{}]',
        stderr: ''
      })
    })
    expect(noFilenames.diagnostics).toEqual([
      expect.objectContaining({
        message: 'npm pack JSON output did not contain filenames'
      })
    ])

    const emptyArray = await packReleasePackages({
      ...baseArgs,
      npmPack: async () => ({
        exitCode: 0,
        stdout: '[]',
        stderr: ''
      })
    })
    expect(emptyArray.diagnostics).toEqual([
      expect.objectContaining({
        message: 'npm pack JSON output did not contain filenames'
      })
    ])
  })

  it('falls back to the real npm pack archive helper when no override is provided', async () => {
    const root = await makeWorkspace()
    const manifest = await createPackage(root, 'core', {
      name: '@mcp-kit/core',
      version: '1.2.3',
      files: ['dist', 'README.md']
    })
    await mkdir(resolve(root, 'tarballs'), { recursive: true })
    await mkdir(resolve(root, 'staging'), { recursive: true })

    const result = await packReleasePackages({
      root,
      manifests: [manifest],
      tarballDirectory: resolve(root, 'tarballs'),
      stagingDirectory: resolve(root, 'staging'),
      signal: new AbortController().signal
    })

    expect(result.diagnostics).toEqual([])
    expect(result.tarballs).toHaveLength(1)
    await expect(readFile(result.tarballs[0]!, 'utf8')).resolves.toBeDefined()
  })
})

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-packaging-'))
  temporaryDirectories.push(root)
  await mkdir(resolve(root, 'packages'), { recursive: true })
  return root
}

async function createPackage(
  root: string,
  directory: string,
  packageJson: Record<string, unknown>
): Promise<WorkspacePackageManifest> {
  const packageRoot = resolve(root, 'packages', directory)
  await mkdir(resolve(packageRoot, 'dist'), { recursive: true })
  await writeFile(resolve(packageRoot, 'dist/index.js'), 'export {}\n')
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
    files: packageJson.files
  }
}

async function successfulPack() {
  return {
    exitCode: 0,
    stdout: '[{"filename":"package.tgz"}]',
    stderr: ''
  }
}
