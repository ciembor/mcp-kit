import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  defineQualityConfig,
  resolveQualityConfig,
  runQuality,
  type QualityConfig
} from './quality.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('quality runner', () => {
  it('resolves standard and off preset behavior', () => {
    const standard = resolveQualityConfig({ preset: 'standard' }, '/project')
    expect(standard.coverage.thresholds).toEqual({
      lines: 90,
      functions: 90,
      statements: 90,
      branches: 85
    })
    expect(standard.formatting.enabled).toBe(true)

    const off = resolveQualityConfig({ preset: 'off' }, '/project')
    expect(off.coverage.enabled).toBe(false)
    expect(off.formatting.enabled).toBe(false)
    expect(off.dependencyCruiser.enabled).toBe(true)
    expect(off.tests.unit.enabled).toBe(true)
  })

  it('validates strict coverage and exclusion reasons', () => {
    expect(() => defineQualityConfig({ preset: 'strict' })).toThrow(
      'coverage.strictInclude'
    )
    expect(() =>
      defineQualityConfig({
        preset: 'standard',
        coverage: { exclude: [{ pattern: 'src/main.ts', reason: '' }] }
      })
    ).toThrow('pattern and a reason')
    expect(() =>
      defineQualityConfig({
        preset: 'standard',
        coverage: { thresholds: { branches: 101 } }
      })
    ).toThrow('between 0 and 100')
    expect(
      defineQualityConfig({
        preset: 'strict',
        coverage: {
          strictInclude: ['src/features/*/application/**/*.ts']
        }
      })
    ).toBeTruthy()
  })

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
