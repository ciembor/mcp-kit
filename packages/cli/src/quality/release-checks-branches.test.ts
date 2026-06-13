import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkVersionsMock,
  checkPackageExportsMock,
  checkPackageFilesMock,
  checkNpmPackMock,
  prepareInstalledReleasePackagesMock,
  cleanupPreparedReleaseMock,
  runInstalledImportSmokeMock,
  runInstalledTypeSmokeMock,
  runInstalledCliSmokeMock,
  supportsStdioSmokeMock,
  supportsHttpSmokeMock,
  releasePackageManifestsMock,
  readGitStatusMock,
  runCommandMock
} = vi.hoisted(() => ({
  checkVersionsMock: vi.fn(),
  checkPackageExportsMock: vi.fn(),
  checkPackageFilesMock: vi.fn(),
  checkNpmPackMock: vi.fn(),
  prepareInstalledReleasePackagesMock: vi.fn(),
  cleanupPreparedReleaseMock: vi.fn(),
  runInstalledImportSmokeMock: vi.fn(),
  runInstalledTypeSmokeMock: vi.fn(),
  runInstalledCliSmokeMock: vi.fn(),
  supportsStdioSmokeMock: vi.fn(),
  supportsHttpSmokeMock: vi.fn(),
  releasePackageManifestsMock: vi.fn(),
  readGitStatusMock: vi.fn(),
  runCommandMock: vi.fn()
}))

vi.mock('./release-checks-package-validations.js', () => ({
  checkVersions: checkVersionsMock,
  checkPackageExports: checkPackageExportsMock,
  checkPackageFiles: checkPackageFilesMock,
  checkNpmPack: checkNpmPackMock
}))

vi.mock('./release-checks-install.js', () => ({
  prepareInstalledReleasePackages: prepareInstalledReleasePackagesMock,
  cleanupPreparedRelease: cleanupPreparedReleaseMock,
  runInstalledImportSmoke: runInstalledImportSmokeMock,
  runInstalledTypeSmoke: runInstalledTypeSmokeMock,
  runInstalledCliSmoke: runInstalledCliSmokeMock
}))

vi.mock('./release-checks-smoke.js', () => ({
  httpSmokeSource: () => 'console.log("http")\n',
  stdioServerSource: () => 'console.log("server")\n',
  stdioSmokeSource: (serverPath: string) =>
    `console.log(${JSON.stringify(serverPath)})\n`,
  supportsHttpSmoke: supportsHttpSmokeMock,
  supportsStdioSmoke: supportsStdioSmokeMock
}))

vi.mock('./release-checks-manifests.js', () => ({
  releasePackageManifests: releasePackageManifestsMock
}))

vi.mock('./release-checks-support.js', async () => {
  const actual = await vi.importActual<
    typeof import('./release-checks-support.js')
  >('./release-checks-support.js')
  return {
    ...actual,
    readGitStatus: readGitStatusMock,
    runCommand: runCommandMock
  }
})

import { runReleaseCheck } from './release-checks.js'

const temporaryDirectories: string[] = []

beforeEach(() => {
  checkVersionsMock.mockReset()
  checkPackageExportsMock.mockReset()
  checkPackageFilesMock.mockReset()
  checkNpmPackMock.mockReset()
  prepareInstalledReleasePackagesMock.mockReset()
  cleanupPreparedReleaseMock.mockReset()
  runInstalledImportSmokeMock.mockReset()
  runInstalledTypeSmokeMock.mockReset()
  runInstalledCliSmokeMock.mockReset()
  supportsStdioSmokeMock.mockReset()
  supportsHttpSmokeMock.mockReset()
  releasePackageManifestsMock.mockReset()
  readGitStatusMock.mockReset()
  runCommandMock.mockReset()
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release checks branches', () => {
  it('dispatches version, package export/file, and npm pack checks through helpers', async () => {
    checkVersionsMock.mockResolvedValueOnce([
      { rule: 'version', file: 'a', message: 'b' }
    ])
    checkPackageExportsMock.mockResolvedValueOnce([
      { rule: 'exports', file: 'a', message: 'b' }
    ])
    checkPackageFilesMock.mockResolvedValueOnce([
      { rule: 'files', file: 'a', message: 'b' }
    ])
    checkNpmPackMock.mockResolvedValueOnce([
      { rule: 'pack', file: 'a', message: 'b' }
    ])

    const signal = new AbortController().signal
    await expect(
      runReleaseCheck('version', { root: '/repo', signal })
    ).resolves.toEqual([{ rule: 'version', file: 'a', message: 'b' }])
    await expect(
      runReleaseCheck('package-exports', { root: '/repo', signal })
    ).resolves.toEqual([{ rule: 'exports', file: 'a', message: 'b' }])
    await expect(
      runReleaseCheck('package-files', { root: '/repo', signal })
    ).resolves.toEqual([{ rule: 'files', file: 'a', message: 'b' }])
    await expect(
      runReleaseCheck('npm-pack', { root: '/repo', signal, npmPack: vi.fn() })
    ).resolves.toEqual([{ rule: 'pack', file: 'a', message: 'b' }])
  })

  it('handles git status failures and dirty entries', async () => {
    const signal = new AbortController().signal
    readGitStatusMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: ''
    })
    await expect(
      runReleaseCheck('clean-git', { root: '/repo', signal })
    ).resolves.toEqual([
      {
        rule: 'release-clean-git',
        file: '.git',
        message: 'Git status check failed'
      }
    ])

    await expect(
      runReleaseCheck('clean-git', {
        root: '/repo',
        signal,
        gitStatus: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: ' M packages/core/package.json\nR  old.ts -> new.ts\n',
            stderr: ''
          })
      })
    ).resolves.toEqual([
      expect.objectContaining({ file: 'packages/core/package.json' }),
      expect.objectContaining({ file: 'new.ts' })
    ])
  })

  it('checks changelog edge cases and current version sections', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-checks-'))
    temporaryDirectories.push(root)
    const signal = new AbortController().signal

    await expect(
      runReleaseCheck('changelog', { root, signal })
    ).resolves.toEqual([
      expect.objectContaining({
        message: 'CHANGELOG.md is required for release quality'
      })
    ])

    await writeFile(resolve(root, 'CHANGELOG.md'), '   ')
    await expect(
      runReleaseCheck('changelog', { root, signal })
    ).resolves.toEqual([
      expect.objectContaining({
        message: 'CHANGELOG.md cannot be empty'
      })
    ])

    await rm(resolve(root, 'package.json'), { force: true })
    await writeFile(
      resolve(root, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n'
    )
    await expect(
      runReleaseCheck('changelog', { root, signal })
    ).resolves.toEqual([])

    await writeFile(resolve(root, 'package.json'), '{broken json')
    await writeFile(resolve(root, 'CHANGELOG.md'), '# Changelog\n\n## 1.2.3\n')
    await expect(
      runReleaseCheck('changelog', { root, signal })
    ).resolves.toEqual([
      expect.objectContaining({
        message:
          'CHANGELOG.md must include an Unreleased or current version section'
      })
    ])

    await writeFile(
      resolve(root, 'package.json'),
      JSON.stringify({ version: '1.2.3' })
    )
    await expect(
      runReleaseCheck('changelog', { root, signal })
    ).resolves.toEqual([])
  })

  it('returns prepared install diagnostics and always cleans up', async () => {
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/prepared',
      diagnostics: [
        { rule: 'install', file: 'package.json', message: 'failed' }
      ]
    })
    cleanupPreparedReleaseMock.mockResolvedValueOnce(undefined)

    await expect(
      runReleaseCheck('install-packages', {
        root: '/repo',
        signal: new AbortController().signal
      })
    ).resolves.toEqual([
      { rule: 'install', file: 'package.json', message: 'failed' }
    ])
    expect(cleanupPreparedReleaseMock).toHaveBeenCalledWith({
      tempRoot: '/tmp/prepared',
      diagnostics: [
        { rule: 'install', file: 'package.json', message: 'failed' }
      ]
    })
  })

  it('walks package usage through prepared, import, type, and cli branches', async () => {
    const signal = new AbortController().signal
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/a',
      diagnostics: [{ rule: 'prepared', file: 'a', message: 'b' }]
    })
    await expect(
      runReleaseCheck('package-usage', { root: '/repo', signal })
    ).resolves.toEqual([{ rule: 'prepared', file: 'a', message: 'b' }])

    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/b',
      diagnostics: []
    })
    await expect(
      runReleaseCheck('package-usage', { root: '/repo', signal })
    ).resolves.toEqual([])

    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/c',
      installDirectory: '/tmp/install',
      manifests: [{ name: 'pkg' }],
      diagnostics: []
    })
    runInstalledImportSmokeMock.mockResolvedValueOnce([
      { rule: 'import', file: 'x', message: 'y' }
    ])
    await expect(
      runReleaseCheck('package-usage', { root: '/repo', signal })
    ).resolves.toEqual([{ rule: 'import', file: 'x', message: 'y' }])

    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/d',
      installDirectory: '/tmp/install',
      manifests: [{ name: 'pkg' }],
      diagnostics: []
    })
    runInstalledImportSmokeMock.mockResolvedValueOnce([])
    runInstalledTypeSmokeMock.mockResolvedValueOnce([
      { rule: 'type', file: 'x', message: 'y' }
    ])
    await expect(
      runReleaseCheck('package-usage', { root: '/repo', signal })
    ).resolves.toEqual([{ rule: 'type', file: 'x', message: 'y' }])

    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/e',
      installDirectory: '/tmp/install',
      manifests: [{ name: 'pkg' }],
      diagnostics: []
    })
    runInstalledImportSmokeMock.mockResolvedValueOnce([])
    runInstalledTypeSmokeMock.mockResolvedValueOnce([])
    runInstalledCliSmokeMock.mockResolvedValueOnce([
      { rule: 'cli', file: 'x', message: 'y' }
    ])
    await expect(
      runReleaseCheck('package-usage', { root: '/repo', signal })
    ).resolves.toEqual([{ rule: 'cli', file: 'x', message: 'y' }])
  })

  it('skips unsupported stdio/http smoke and maps script failures', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-smoke-'))
    temporaryDirectories.push(root)
    const installDirectory = resolve(root, 'install')
    await mkdir(installDirectory, { recursive: true })

    supportsStdioSmokeMock.mockReturnValueOnce(false)
    releasePackageManifestsMock.mockResolvedValueOnce([])
    await expect(
      runReleaseCheck('stdio-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([])

    supportsHttpSmokeMock.mockReturnValueOnce(false)
    releasePackageManifestsMock.mockResolvedValueOnce([])
    await expect(
      runReleaseCheck('http-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([])

    supportsStdioSmokeMock.mockReturnValueOnce(true)
    releasePackageManifestsMock.mockResolvedValueOnce([
      { name: '@mcp-kit/core' }
    ])
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/s1',
      diagnostics: [{ rule: 'prepared', file: 'x', message: 'y' }]
    })
    await expect(
      runReleaseCheck('stdio-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([{ rule: 'prepared', file: 'x', message: 'y' }])

    supportsStdioSmokeMock.mockReturnValueOnce(true)
    releasePackageManifestsMock.mockResolvedValueOnce([
      { name: '@mcp-kit/core' }
    ])
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/f',
      diagnostics: []
    })
    await expect(
      runReleaseCheck('stdio-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([])

    supportsStdioSmokeMock.mockReturnValueOnce(true)
    releasePackageManifestsMock.mockResolvedValueOnce([
      { name: '@mcp-kit/core' }
    ])
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/g',
      installDirectory,
      manifests: [],
      diagnostics: []
    })
    runCommandMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: ''
    })
    await expect(
      runReleaseCheck('stdio-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([
      expect.objectContaining({
        file: 'stdio-smoke.mjs',
        message: 'Packaged stdio smoke failed: stdio smoke failed'
      })
    ])
    await expect(
      readFile(resolve(installDirectory, 'stdio-server.mjs'), 'utf8')
    ).resolves.toContain('console.log("server")')

    supportsHttpSmokeMock.mockReturnValueOnce(true)
    releasePackageManifestsMock.mockResolvedValueOnce([
      { name: '@mcp-kit/core' }
    ])
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/h1',
      diagnostics: [{ rule: 'prepared', file: 'x', message: 'y' }]
    })
    await expect(
      runReleaseCheck('http-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([{ rule: 'prepared', file: 'x', message: 'y' }])

    supportsHttpSmokeMock.mockReturnValueOnce(true)
    releasePackageManifestsMock.mockResolvedValueOnce([
      { name: '@mcp-kit/core' }
    ])
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/h2',
      diagnostics: []
    })
    await expect(
      runReleaseCheck('http-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([])

    supportsHttpSmokeMock.mockReturnValueOnce(true)
    releasePackageManifestsMock.mockResolvedValueOnce([
      { name: '@mcp-kit/core' }
    ])
    prepareInstalledReleasePackagesMock.mockResolvedValueOnce({
      tempRoot: '/tmp/h',
      installDirectory,
      manifests: [],
      diagnostics: []
    })
    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(
      runReleaseCheck('http-smoke', {
        root,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([])
    await expect(
      readFile(resolve(installDirectory, 'http-smoke.mjs'), 'utf8')
    ).resolves.toContain('console.log("http")')
  })
})
