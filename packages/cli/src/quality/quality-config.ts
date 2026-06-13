import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  CoverageThresholds,
  MutationConfig,
  QualityCommand,
  QualityConfig,
  ResolvedQualityConfig
} from './contracts.js'

const standardThresholds: CoverageThresholds = {
  lines: 90,
  functions: 90,
  statements: 90,
  branches: 85
}
const strictThresholds: CoverageThresholds = {
  lines: 100,
  functions: 100,
  statements: 100,
  branches: 100
}

export function defineQualityConfig(config: QualityConfig): QualityConfig {
  validateQualityConfig(config)
  return Object.freeze(config)
}

export async function loadQualityConfig(root: string): Promise<QualityConfig> {
  const candidates = [
    'quality.config.ts',
    'quality.config.js',
    'quality.config.mjs'
  ]
  for (const candidate of candidates) {
    const path = resolve(root, candidate)
    try {
      await access(path)
    } catch {
      continue
    }
    const module = (await import(
      `${pathToFileURL(path).href}?updated=${Date.now()}`
    )) as { default?: unknown }
    if (!isQualityConfig(module.default)) {
      throw new Error(`${candidate} must export a quality configuration`)
    }
    validateQualityConfig(module.default)
    return module.default
  }
  return { preset: 'standard' }
}

export function resolveQualityConfig(
  config: QualityConfig,
  root: string
): ResolvedQualityConfig {
  validateQualityConfig(config)
  const preset = config.preset
  const toolsEnabled = preset !== 'off'
  const coverageEnabled = preset !== 'off' && config.coverage?.enabled !== false
  const thresholds = preset === 'strict' ? strictThresholds : standardThresholds
  return {
    preset,
    project: resolveProject(config, root),
    formatting: resolveFormatting(config, toolsEnabled),
    lint: resolveLint(config, toolsEnabled),
    smells: command(config.smells, 'knip', toolsEnabled),
    typecheck: command(config.typecheck, 'tsc --noEmit', toolsEnabled),
    deadCode: command(config.deadCode, 'knip', toolsEnabled),
    dependencyCruiser: command(
      config.dependencyCruiser,
      'dependency-cruiser src --config dependency-cruiser.config.cjs',
      true
    ),
    mutation: resolveMutation(config),
    tests: resolveTests(config),
    coverage: resolveCoverage(config, thresholds, coverageEnabled),
    build: command(config.build, 'npm run build --if-present', true),
    packageSmoke: command(config.packageSmoke, '', false)
  }
}

function resolveProject(config: QualityConfig, root: string) {
  return {
    root: resolve(root, config.project?.root ?? '.'),
    source: config.project?.source ?? ['src/**/*.ts', 'src/**/*.js'],
    tests: config.project?.tests ?? [
      'test/**/*.test.ts',
      'src/**/*.test.ts',
      'test/**/*.test.js'
    ]
  }
}

function resolveFormatting(config: QualityConfig, enabled: boolean) {
  return command(config.formatting, 'prettier --check .', enabled, {
    fixCommand: config.formatting?.fixCommand ?? 'prettier --write .'
  })
}

function resolveLint(config: QualityConfig, enabled: boolean) {
  return command(config.lint, 'eslint .', enabled, {
    typed: config.lint?.typed ?? true,
    fixCommand: config.lint?.fixCommand ?? 'eslint . --fix'
  })
}

function resolveTests(config: QualityConfig) {
  return {
    unit: command(config.tests?.unit, 'vitest run', true),
    integration: command(config.tests?.integration, '', false),
    contract: command(config.tests?.contract, '', false),
    architecture: command(config.tests?.architecture, '', false)
  }
}

function resolveMutation(config: QualityConfig) {
  const mutation: MutationConfig = {
    command: config.mutation?.command ?? 'stryker run',
    ...(config.mutation ?? {})
  }
  return command(mutation, 'stryker run', false, {
    command: mutationCommand(mutation),
    threshold: mutation.threshold ?? 80,
    runInRelease: mutation.runInRelease ?? false,
    exclude: mutation.exclude ?? []
  })
}

function resolveCoverage(
  config: QualityConfig,
  thresholds: CoverageThresholds,
  enabled: boolean
) {
  const coverage = config.coverage ?? {}
  const include = coverage.include ?? ['src/**/*.{ts,js}']
  const exclude = coverage.exclude ?? []
  const strictInclude = coverage.strictInclude ?? []
  return {
    enabled,
    command: coverage.command ?? coverageCommand(config, thresholds),
    thresholds: { ...thresholds, ...coverage.thresholds },
    include,
    exclude,
    strictInclude
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function command<Extra extends Record<string, unknown> = Record<string, never>>(
  input: QualityCommand | undefined,
  defaultCommand: string,
  defaultEnabled: boolean,
  extra?: Extra
): QualityCommand & Extra {
  return {
    enabled: input?.enabled ?? defaultEnabled,
    command: input?.command ?? defaultCommand,
    ...(extra ?? ({} as Extra))
  }
}

function coverageCommand(
  config: QualityConfig,
  thresholds: CoverageThresholds
): string {
  const resolved = { ...thresholds, ...config.coverage?.thresholds }
  const include = coverageIncludes(config)
  const exclusions = config.coverage?.exclude ?? []
  return [
    'vitest run --coverage',
    `--coverage.thresholds.lines=${resolved.lines}`,
    `--coverage.thresholds.functions=${resolved.functions}`,
    `--coverage.thresholds.statements=${resolved.statements}`,
    `--coverage.thresholds.branches=${resolved.branches}`,
    ...include.map((pattern) => `--coverage.include=${shellQuote(pattern)}`),
    ...exclusions.map(
      (exclusion) => `--coverage.exclude=${shellQuote(exclusion.pattern)}`
    )
  ].join(' ')
}

function coverageIncludes(config: QualityConfig): readonly string[] {
  if (config.preset === 'strict') {
    return config.coverage?.strictInclude ?? []
  }
  return config.coverage?.include ?? ['src/**/*.{ts,js}']
}

function validateQualityConfig(config: QualityConfig): void {
  if (!['off', 'standard', 'strict'].includes(config.preset)) {
    throw new Error(`Unknown quality preset: ${String(config.preset)}`)
  }
  validateCoverageExclusions(config)
  validateCoverageThresholds(config)
  validateMutationConfig(config)
  validateStrictCoverage(config)
}

function validateCoverageExclusions(config: QualityConfig): void {
  for (const exclusion of config.coverage?.exclude ?? []) {
    if (exclusion.pattern.trim() === '' || exclusion.reason.trim() === '') {
      throw new Error('Coverage exclusions require a pattern and a reason')
    }
  }
}

function validateCoverageThresholds(config: QualityConfig): void {
  const thresholds = config.coverage?.thresholds
  if (thresholds === undefined) return
  for (const [name, value] of Object.entries(thresholds)) {
    if (value < 0 || value > 100) {
      throw new Error(`Coverage threshold ${name} must be between 0 and 100`)
    }
  }
}

function validateMutationConfig(config: QualityConfig): void {
  const mutation = config.mutation
  if (!mutationThresholdIsValid(mutation?.threshold)) {
    throw new Error('Mutation threshold must be between 0 and 100')
  }
  for (const exclusion of mutation?.exclude ?? []) {
    if (exclusion.pattern.trim() === '' || exclusion.reason.trim() === '') {
      throw new Error('Mutation exclusions require a pattern and a reason')
    }
  }
}

function mutationCommand(config: MutationConfig): string {
  const exclusions = config.exclude ?? []
  if (exclusions.length === 0) return config.command
  return [
    config.command,
    ...exclusions.map(
      (exclusion) => `--mutate ${shellQuote(negatedMutationPattern(exclusion))}`
    )
  ].join(' ')
}

function validateStrictCoverage(config: QualityConfig): void {
  if (
    config.preset === 'strict' &&
    config.coverage?.enabled !== false &&
    (config.coverage?.strictInclude?.length ?? 0) === 0
  ) {
    throw new Error('Strict quality requires coverage.strictInclude')
  }
}

function isQualityConfig(value: unknown): value is QualityConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'preset' in value &&
    typeof value.preset === 'string'
  )
}

function mutationThresholdIsValid(threshold: number | undefined): boolean {
  return threshold === undefined || (threshold >= 0 && threshold <= 100)
}

function negatedMutationPattern(exclusion: { pattern: string }): string {
  return `!${exclusion.pattern}`
}
