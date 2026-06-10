import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  defineQualityConfig,
  loadQualityConfig,
  resolveQualityConfig,
  shellQuote
} from './quality-config.js'
import type { QualityConfig } from '../quality.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      const { rm } = await import('node:fs/promises')
      await rm(directory, { recursive: true, force: true })
    })
  )
})

describe('quality config', () => {
  it('resolves defaults for standard and off presets', () => {
    const standard = resolveQualityConfig({ preset: 'standard' }, '/project')
    expect(standard.formatting.enabled).toBe(true)
    expect(standard.lint.typed).toBe(true)
    expect(standard.coverage.enabled).toBe(true)
    expect(standard.coverage.thresholds).toEqual({
      lines: 90,
      functions: 90,
      statements: 90,
      branches: 85
    })

    const off = resolveQualityConfig({ preset: 'off' }, '/project')
    expect(off.formatting.enabled).toBe(false)
    expect(off.lint.enabled).toBe(false)
    expect(off.coverage.enabled).toBe(false)
    expect(off.build.enabled).toBe(true)
  })

  it('loads quality config from disk and validates the default export', async () => {
    const fallbackRoot = await createTempDirectory('mcp-kit-quality-config-')
    await expect(loadQualityConfig(fallbackRoot)).resolves.toEqual({
      preset: 'standard'
    })

    const invalidRoot = await createTempDirectory('mcp-kit-quality-config-')
    await writeFile(
      resolve(invalidRoot, 'quality.config.js'),
      'export default { notPreset: true }\n'
    )
    await expect(loadQualityConfig(invalidRoot)).rejects.toThrow(
      'quality.config.js must export a quality configuration'
    )

    const validRoot = await createTempDirectory('mcp-kit-quality-config-')
    await writeFile(
      resolve(validRoot, 'quality.config.mjs'),
      'export default { preset: "off" }\n'
    )
    await expect(loadQualityConfig(validRoot)).resolves.toEqual({
      preset: 'off'
    })
  })

  it('rejects invalid presets and coverage settings', () => {
    expect(() =>
      defineQualityConfig({ preset: 'unknown' as QualityConfig['preset'] })
    ).toThrow('Unknown quality preset')
    expect(() => defineQualityConfig({ preset: 'strict' })).toThrow(
      'Strict quality requires coverage.strictInclude'
    )
    expect(() =>
      defineQualityConfig({
        preset: 'standard',
        coverage: { exclude: [{ pattern: '', reason: 'why' }] }
      })
    ).toThrow('Coverage exclusions require a pattern and a reason')
    expect(() =>
      defineQualityConfig({
        preset: 'standard',
        coverage: { exclude: [{ pattern: 'src/**', reason: '' }] }
      })
    ).toThrow('Coverage exclusions require a pattern and a reason')
    expect(() =>
      defineQualityConfig({
        preset: 'standard',
        coverage: { thresholds: { lines: 101 } }
      })
    ).toThrow('Coverage threshold lines must be between 0 and 100')
  })

  it('builds coverage commands for standard and strict presets', () => {
    const standard = resolveQualityConfig(
      {
        preset: 'standard',
        coverage: {
          include: ['src/**/*.ts'],
          exclude: [{ pattern: "src/**/it's.ts", reason: 'special file' }]
        }
      },
      '/project'
    )
    expect(standard.coverage.command).toContain(
      "--coverage.include='src/**/*.ts'"
    )
    expect(standard.coverage.command).toContain(
      "--coverage.exclude='src/**/it'\\''s.ts'"
    )

    const strict = resolveQualityConfig(
      {
        preset: 'strict',
        coverage: {
          strictInclude: ['src/core/**/*.ts'],
          thresholds: { branches: 95 }
        }
      },
      '/project'
    )
    expect(strict.coverage.include).toEqual(['src/**/*.{ts,js}'])
    expect(strict.coverage.strictInclude).toEqual(['src/core/**/*.ts'])
    expect(strict.coverage.command).toContain(
      "--coverage.include='src/core/**/*.ts'"
    )
    expect(strict.coverage.thresholds).toEqual({
      lines: 100,
      functions: 100,
      statements: 100,
      branches: 95
    })
  })

  it('allows strict preset when coverage is disabled', () => {
    const strictWithoutCoverage = resolveQualityConfig(
      {
        preset: 'strict',
        coverage: {
          enabled: false
        }
      },
      '/project'
    )

    expect(strictWithoutCoverage.coverage.enabled).toBe(false)
    expect(strictWithoutCoverage.coverage.strictInclude).toEqual([])
  })

  it('shell-quotes values for CLI flags', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })
})

async function createTempDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix))
  temporaryDirectories.push(root)
  return root
}
