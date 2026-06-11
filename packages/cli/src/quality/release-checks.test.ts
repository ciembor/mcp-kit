import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runQuality } from '../quality.js'
import type {
  ReleaseNpmInstallResult,
  ReleaseNpmPackResult
} from './contracts.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release quality checks', () => {
  it('passes clean git, version, and changelog checks for a consistent workspace', async () => {
    const root = await makeReleaseWorkspace()
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: successfulNpmInstall,
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('passed')
    expect(report.steps.slice(-11)).toMatchObject([
      { name: 'clean-git', status: 'passed' },
      { name: 'version', status: 'passed' },
      { name: 'changelog', status: 'passed' },
      { name: 'package-exports', status: 'passed' },
      { name: 'package-files', status: 'passed' },
      { name: 'npm-pack', status: 'passed' },
      { name: 'install-packages', status: 'passed' },
      { name: 'package-usage', status: 'passed' },
      { name: 'stdio-smoke', status: 'passed' },
      { name: 'http-smoke', status: 'passed' },
      { name: 'mutation', status: 'skipped' }
    ])
  })

  it('runs mutation in release only when the project opts in', async () => {
    const root = await makeReleaseWorkspace()
    const commands: string[] = []
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: successfulNpmInstall,
      config: {
        ...releaseOnlyConfig(),
        mutation: {
          enabled: true,
          command: 'mutation',
          runInRelease: true,
          threshold: 80
        }
      },
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(report.status).toBe('passed')
    expect(commands.at(-1)).toBe('mutation')
    expect(step(report, 'mutation')).toMatchObject({
      name: 'mutation',
      status: 'passed'
    })
  })

  it('fails release mode on a dirty git worktree and skips later release checks', async () => {
    const root = await makeReleaseWorkspace()
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: ' M packages/core/package.json\n',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: successfulNpmInstall,
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('failed')
    expect(step(report, 'clean-git')).toMatchObject({
      name: 'clean-git',
      status: 'failed',
      diagnostics: [
        expect.objectContaining({
          rule: 'release-clean-git',
          file: 'packages/core/package.json'
        })
      ]
    })
    expect(step(report, 'version')).toMatchObject({
      name: 'version',
      status: 'skipped'
    })
  })

  it('fails release mode when workspace package versions diverge', async () => {
    const root = await makeReleaseWorkspace({
      packageVersion: '1.2.4'
    })
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: successfulNpmInstall,
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('failed')
    expect(step(report, 'version')).toMatchObject({
      name: 'version',
      status: 'failed',
      diagnostics: [
        expect.objectContaining({
          rule: 'release-version',
          file: 'packages/core/package.json'
        })
      ]
    })
    expect(step(report, 'changelog')).toMatchObject({
      name: 'changelog',
      status: 'skipped'
    })
  })

  it('fails release mode when changelog is missing a release section', async () => {
    const root = await makeReleaseWorkspace({ changelog: '# Changelog\n' })
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: successfulNpmInstall,
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('failed')
    expect(step(report, 'changelog')).toMatchObject({
      name: 'changelog',
      status: 'failed',
      diagnostics: [
        expect.objectContaining({
          rule: 'release-changelog',
          file: 'CHANGELOG.md'
        })
      ]
    })
  })

  it('fails release mode when files do not cover the exported entrypoints', async () => {
    const root = await makeReleaseWorkspace({
      files: ['README.md']
    })
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: successfulNpmInstall,
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('failed')
    const packageFilesStep = step(report, 'package-files')
    expect(packageFilesStep).toMatchObject({
      name: 'package-files',
      status: 'failed'
    })
    expect(packageFilesStep?.diagnostics).toContainEqual(
      expect.objectContaining({
        rule: 'release-package-files',
        file: 'packages/core/package.json'
      })
    )
  })

  it('fails release mode when exports point outside dist', async () => {
    const root = await makeReleaseWorkspace({
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './src/index.ts'
        }
      }
    })
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: successfulNpmInstall,
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('failed')
    expect(step(report, 'package-exports')).toMatchObject({
      name: 'package-exports',
      status: 'failed',
      diagnostics: [
        expect.objectContaining({
          rule: 'release-package-exports',
          file: 'packages/core/package.json'
        })
      ]
    })
  })

  it('fails release mode when npm pack does not succeed', async () => {
    const root = await makeReleaseWorkspace()
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: () =>
        Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'pack failed'
        }),
      npmInstall: successfulNpmInstall,
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('failed')
    expect(step(report, 'npm-pack')).toMatchObject({
      name: 'npm-pack',
      status: 'failed',
      diagnostics: [
        expect.objectContaining({
          rule: 'release-npm-pack',
          file: 'packages/core/package.json'
        })
      ]
    })
  })

  it('fails release mode when packed tarballs cannot be installed', async () => {
    const root = await makeReleaseWorkspace()
    const report = await runQuality({
      root,
      mode: 'release',
      gitStatus: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      npmPack: successfulNpmPack,
      npmInstall: () =>
        Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'install failed'
        }),
      config: releaseOnlyConfig()
    })

    expect(report.status).toBe('failed')
    expect(step(report, 'install-packages')).toMatchObject({
      name: 'install-packages',
      status: 'failed',
      diagnostics: [
        expect.objectContaining({
          rule: 'release-install-packages',
          file: 'package.json'
        })
      ]
    })
  })
})

function releaseOnlyConfig() {
  return {
    preset: 'off' as const,
    dependencyCruiser: { enabled: false, command: '' },
    formatting: { enabled: false, command: '' },
    lint: { enabled: false, command: '', typed: false },
    smells: { enabled: false, command: '' },
    typecheck: { enabled: false, command: '' },
    deadCode: { enabled: false, command: '' },
    tests: {
      unit: { enabled: false, command: '' },
      integration: { enabled: false, command: '' },
      contract: { enabled: false, command: '' },
      architecture: { enabled: false, command: '' }
    },
    coverage: { enabled: false, command: '' },
    build: { enabled: false, command: '' },
    packageSmoke: { enabled: false, command: '' },
    mutation: {
      enabled: false,
      command: '',
      runInRelease: false,
      threshold: 80
    }
  }
}

async function makeReleaseWorkspace(
  options: {
    rootVersion?: string
    packageVersion?: string
    changelog?: string
    exports?: unknown
    files?: readonly string[]
  } = {}
): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-quality-'))
  temporaryDirectories.push(root)
  const rootVersion = options.rootVersion ?? '1.2.3'
  const packageVersion = options.packageVersion ?? rootVersion

  await mkdir(resolve(root, 'packages/core/src'), { recursive: true })
  await mkdir(resolve(root, 'packages/core/dist'), { recursive: true })
  await writeFile(
    resolve(root, 'package.json'),
    JSON.stringify({ name: 'repo', private: true, version: rootVersion })
  )
  await writeFile(
    resolve(root, 'CHANGELOG.md'),
    options.changelog ?? '# Changelog\n\n## [Unreleased]\n\n- Pending.\n'
  )
  await writeFile(
    resolve(root, 'packages/core/package.json'),
    JSON.stringify({
      name: '@mcp-kit/core',
      version: packageVersion,
      type: 'module',
      exports: options.exports ?? {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js'
        }
      },
      files: options.files ?? ['dist', 'README.md']
    })
  )
  await writeFile(resolve(root, 'packages/core/README.md'), '# core\n')
  await writeFile(
    resolve(root, 'packages/core/dist/index.js'),
    `export const packageInfo = {
  name: '@mcp-kit/core',
  version: '${packageVersion}'
}
`
  )
  await writeFile(
    resolve(root, 'packages/core/dist/index.d.ts'),
    `export declare const packageInfo: {
  readonly name: '@mcp-kit/core'
  readonly version: '${packageVersion}'
}
`
  )
  await writeFile(
    resolve(root, 'packages/core/src/index.ts'),
    `export const packageInfo = {
  name: '@mcp-kit/core',
  version: '${packageVersion}'
} as const
`
  )

  return root
}

function successfulNpmPack(): Promise<ReleaseNpmPackResult> {
  return Promise.resolve({
    exitCode: 0,
    stdout: '[{"filename":"mcp-kit-core.tgz"}]',
    stderr: ''
  })
}

function successfulNpmInstall(): Promise<ReleaseNpmInstallResult> {
  return Promise.resolve({
    exitCode: 0,
    stdout: '',
    stderr: ''
  })
}

function step(report: Awaited<ReturnType<typeof runQuality>>, name: string) {
  return report.steps.find((candidate) => candidate.name === name)
}
