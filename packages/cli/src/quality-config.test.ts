import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  defineQualityConfig,
  loadQualityConfig,
  resolveQualityConfig,
  shellQuote
} from './quality-config.js'
import type { QualityConfig } from './quality.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('quality config', () => {
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

  it('loads fallback configs and rejects invalid config modules', async () => {
    const fallbackRoot = await makeProject()
    await expect(loadQualityConfig(fallbackRoot)).resolves.toEqual({
      preset: 'standard'
    })

    const invalidRoot = await makeProject()
    await writeProjectFile(
      invalidRoot,
      'quality.config.js',
      'export default { preset: 1 }\n'
    )
    await expect(loadQualityConfig(invalidRoot)).rejects.toThrow(
      'must export a quality configuration'
    )

    const validRoot = await makeProject()
    await writeProjectFile(
      validRoot,
      'quality.config.js',
      "export default { preset: 'off' }\n"
    )
    await expect(loadQualityConfig(validRoot)).resolves.toEqual({
      preset: 'off'
    })
  })

  it('validates strict coverage and exclusion reasons', () => {
    expect(() =>
      defineQualityConfig({ preset: 'unknown' as QualityConfig['preset'] })
    ).toThrow('Unknown quality preset')
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

  it('renders shell-quoted coverage commands with strict includes and exclusions', () => {
    expect(shellQuote("main's")).toBe("'main'\\''s'")

    const standard = resolveQualityConfig(
      {
        preset: 'standard',
        coverage: {
          include: ["src/custom's.ts"],
          thresholds: { branches: 100 }
        }
      },
      '/project'
    )
    expect(standard.coverage.command).toContain(
      "--coverage.include='src/custom'\\''s.ts'"
    )

    const strict = resolveQualityConfig(
      {
        preset: 'strict',
        coverage: {
          strictInclude: ['src/domain/**/*.ts'],
          exclude: [{ pattern: "src/generated's.ts", reason: 'generated' }]
        }
      },
      '/project'
    )

    expect(strict.coverage.command).toContain(
      "--coverage.include='src/domain/**/*.ts'"
    )
    expect(strict.coverage.command).toContain(
      "--coverage.exclude='src/generated'\\''s.ts'"
    )

    const strictWithoutCoverage = resolveQualityConfig(
      {
        preset: 'strict',
        coverage: { enabled: false }
      },
      '/project'
    )
    expect(strictWithoutCoverage.coverage.command).not.toContain(
      '--coverage.include='
    )
  })
})

async function makeProject(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-quality-config-'))
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
