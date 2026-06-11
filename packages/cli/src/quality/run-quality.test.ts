import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runQuality } from '../quality.js'
import type { QualityConfig } from './contracts.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('quality runner', () => {
  it('runs full steps in order and stops after a failed command', async () => {
    const root = await makeProject()
    const commands: string[] = []
    const report = await runQuality({
      root,
      mode: 'full',
      config: configWithCommands(),
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(command === 'typecheck' ? 2 : 0)
      }
    })

    expect(commands).toEqual(['format', 'lint', 'smells', 'typecheck'])
    expect(report.status).toBe('failed')
    expect(
      report.steps.find((step) => step.name === 'typecheck')
    ).toMatchObject({
      status: 'failed',
      exitCode: 2
    })
    expect(
      report.steps.find((step) => step.name === 'dead-code')
    ).toMatchObject({
      status: 'skipped'
    })
  })

  it('keeps architecture analysis active when quality is off', async () => {
    const root = await makeProject()
    await writeProjectFile(
      root,
      'src/features/broken/domain/value.ts',
      "import '@modelcontextprotocol/sdk/types.js'\n"
    )
    const commands: string[] = []
    const report = await runQuality({
      root,
      mode: 'fast',
      config: {
        preset: 'off',
        dependencyCruiser: { enabled: false, command: '' },
        tests: { unit: { enabled: false, command: '' } },
        build: { enabled: false, command: '' }
      },
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(commands).toEqual([])
    expect(report.status).toBe('failed')
    expect(
      report.steps.find((step) => step.name === 'architecture')?.diagnostics
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'no-mcp-sdk-in-policy' })
      ])
    )
  })

  it('uses fix commands and scopes changed tests with since', async () => {
    const root = await makeProject()
    const commands: string[] = []
    const report = await runQuality({
      root,
      mode: 'fast',
      fix: true,
      since: "main's",
      config: {
        ...configWithCommands(),
        formatting: {
          command: 'format-check',
          fixCommand: 'format-fix'
        },
        lint: {
          command: 'lint-check',
          fixCommand: 'lint-fix',
          typed: true
        }
      },
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(report.status).toBe('passed')
    expect(commands).toEqual([
      'format-fix',
      'lint-fix',
      'typecheck',
      "unit --changed 'main'\\''s'"
    ])
  })

  it('uses fix commands in full mode', async () => {
    const root = await makeProject()
    const commands: string[] = []
    const report = await runQuality({
      root,
      mode: 'full',
      fix: true,
      config: {
        ...configWithCommands(),
        formatting: {
          command: 'format-check',
          fixCommand: 'format-fix'
        },
        lint: {
          command: 'lint-check',
          fixCommand: 'lint-fix',
          typed: false
        }
      },
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(command === 'smells' ? 2 : 0)
      }
    })

    expect(report.status).toBe('failed')
    expect(commands).toEqual(['format-fix', 'lint-fix', 'smells'])
  })

  it('runs mutation as the final full quality step when enabled', async () => {
    const root = await makeProject()
    const commands: string[] = []
    const report = await runQuality({
      root,
      mode: 'full',
      config: {
        ...configWithCommands(),
        mutation: { enabled: true, command: 'mutation' }
      },
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(report.status).toBe('passed')
    expect(commands.at(-1)).toBe('mutation')
    expect(report.steps.at(-1)).toMatchObject({
      name: 'mutation',
      status: 'passed'
    })
  })

  it('runs release mode through the full quality pipeline', async () => {
    const root = await makeProject()
    await writeFile(
      resolve(root, 'package.json'),
      JSON.stringify({ name: 'repo', private: true, version: '1.2.3' })
    )
    await writeFile(
      resolve(root, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n'
    )
    await mkdir(resolve(root, 'packages/core/src'), { recursive: true })
    await writeFile(
      resolve(root, 'packages/core/package.json'),
      JSON.stringify({
        name: '@mcp-kit/core',
        version: '1.2.3',
        type: 'module',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js'
          }
        },
        files: ['dist', 'README.md']
      })
    )
    await writeFile(resolve(root, 'packages/core/README.md'), '# core\n')
    await writeFile(
      resolve(root, 'packages/core/src/index.ts'),
      "export const packageInfo = {\n  name: '@mcp-kit/core',\n  version: '1.2.3'\n} as const\n"
    )
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
      config: configWithCommands(),
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(report.status).toBe('passed')
    expect(commands).toEqual([
      'format',
      'lint',
      'smells',
      'typecheck',
      'dead-code',
      'dependencies',
      'unit',
      'integration',
      'contract',
      'architecture',
      'coverage',
      'build',
      'smoke'
    ])
    expect(report.steps.map((step) => step.name).slice(-6)).toEqual([
      'clean-git',
      'version',
      'changelog',
      'package-exports',
      'package-files',
      'mutation'
    ])
  })

  it('skips mutation by default', async () => {
    const root = await makeProject()
    const commands: string[] = []
    const report = await runQuality({
      root,
      mode: 'full',
      config: configWithCommands(),
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(report.steps.at(-1)).toMatchObject({
      name: 'mutation',
      status: 'skipped'
    })
    expect(commands).not.toContain('stryker run')
  })

  it('reports an aborted run without starting commands', async () => {
    const root = await makeProject()
    const controller = new AbortController()
    controller.abort()
    const report = await runQuality({
      root,
      mode: 'fast',
      signal: controller.signal,
      config: configWithCommands(),
      execute: () => Promise.resolve(0)
    })

    expect(report.status).toBe('failed')
    expect(report.steps[0]).toMatchObject({ status: 'failed', exitCode: 130 })
  })

  it('executes real commands and reports process failures and signals', async () => {
    const root = await makeProject()
    const passed = await runQuality({
      root,
      mode: 'fast',
      config: {
        preset: 'standard',
        formatting: { command: 'node -e "process.exit(0)"' },
        lint: { command: 'node -e "process.exit(0)"', typed: false },
        typecheck: { command: 'node -e "process.exit(0)"' },
        tests: { unit: { command: 'node -e "process.exit(0)"' } }
      }
    })
    expect(passed.status).toBe('passed')
    expect(passed.steps.map((step) => step.command).filter(Boolean)).toEqual([
      'node -e "process.exit(0)"',
      'node -e "process.exit(0)"',
      'node -e "process.exit(0)"',
      'node -e "process.exit(0)"'
    ])

    const failed = await runQuality({
      root,
      mode: 'fast',
      config: {
        preset: 'standard',
        formatting: { command: 'node -e "process.exit(7)"' }
      }
    })
    expect(failed.status).toBe('failed')
    expect(failed.steps[0]).toMatchObject({ status: 'failed', exitCode: 7 })

    const spawnError = await runQuality({
      root: resolve(root, 'missing'),
      mode: 'fast',
      config: {
        preset: 'standard',
        formatting: { command: 'node -e "process.exit(0)"' }
      }
    })
    expect(spawnError.status).toBe('failed')
    expect(spawnError.steps[0]).toMatchObject({
      status: 'failed',
      exitCode: 70
    })

    const killed = await runQuality({
      root,
      mode: 'fast',
      config: {
        preset: 'standard',
        formatting: {
          command: 'node -e "process.kill(process.pid, \'SIGKILL\')"'
        }
      }
    })
    expect(killed.status).toBe('failed')
    expect(killed.steps[0]).toMatchObject({ status: 'failed', exitCode: 70 })

    const controller = new AbortController()
    const aborted = runQuality({
      root,
      mode: 'fast',
      signal: controller.signal,
      config: {
        preset: 'standard',
        formatting: {
          command: 'node -e "setTimeout(() => {}, 10000)"'
        }
      }
    })
    setTimeout(() => controller.abort(), 50)
    await expect(aborted).resolves.toMatchObject({ status: 'failed' })
  })
})

function configWithCommands(): QualityConfig {
  return {
    preset: 'standard',
    formatting: { command: 'format' },
    lint: { command: 'lint', typed: true },
    smells: { command: 'smells' },
    typecheck: { command: 'typecheck' },
    deadCode: { command: 'dead-code' },
    dependencyCruiser: { command: 'dependencies' },
    tests: {
      unit: { command: 'unit' },
      integration: { enabled: true, command: 'integration' },
      contract: { enabled: true, command: 'contract' },
      architecture: { enabled: true, command: 'architecture' }
    },
    coverage: { command: 'coverage' },
    build: { command: 'build' },
    packageSmoke: { enabled: true, command: 'smoke' }
  }
}

async function makeProject(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-quality-'))
  temporaryDirectories.push(root)
  return root
}

async function writeProjectFile(
  root: string,
  path: string,
  content: string
): Promise<void> {
  const absolute = resolve(root, path)
  await mkdir(resolve(absolute, '..'), { recursive: true })
  await writeFile(absolute, content)
}
