import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { analyzeProject, type ProjectDiagnostic } from './project-analysis.js'

export type QualityPreset = 'off' | 'standard' | 'strict'
export type QualityMode = 'fast' | 'full'
export type CoverageThresholds = {
  lines: number
  functions: number
  statements: number
  branches: number
}
export type CoverageExclusion = {
  pattern: string
  reason: string
}
type QualityCommand = {
  enabled?: boolean
  command: string
}
export type QualityConfig = {
  preset: QualityPreset
  project?: {
    root?: string
    source?: readonly string[]
    tests?: readonly string[]
  }
  formatting?: QualityCommand & { fixCommand?: string }
  lint?: QualityCommand & { typed?: boolean; fixCommand?: string }
  smells?: QualityCommand
  typecheck?: QualityCommand
  deadCode?: QualityCommand
  dependencyCruiser?: QualityCommand
  tests?: {
    unit?: QualityCommand
    integration?: QualityCommand
    contract?: QualityCommand
    architecture?: QualityCommand
  }
  coverage?: {
    enabled?: boolean
    command?: string
    thresholds?: Partial<CoverageThresholds>
    include?: readonly string[]
    exclude?: readonly CoverageExclusion[]
    strictInclude?: readonly string[]
  }
  build?: QualityCommand
  packageSmoke?: QualityCommand
}
export type ResolvedQualityConfig = {
  preset: QualityPreset
  project: {
    root: string
    source: readonly string[]
    tests: readonly string[]
  }
  formatting: QualityCommand & { fixCommand: string }
  lint: QualityCommand & { typed: boolean; fixCommand: string }
  smells: QualityCommand
  typecheck: QualityCommand
  deadCode: QualityCommand
  dependencyCruiser: QualityCommand
  tests: {
    unit: QualityCommand
    integration: QualityCommand
    contract: QualityCommand
    architecture: QualityCommand
  }
  coverage: {
    enabled: boolean
    command: string
    thresholds: CoverageThresholds
    include: readonly string[]
    exclude: readonly CoverageExclusion[]
    strictInclude: readonly string[]
  }
  build: QualityCommand
  packageSmoke: QualityCommand
}
export type QualityStepResult = {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  command?: string
  exitCode?: number
  diagnostics?: readonly ProjectDiagnostic[]
}
export type QualityReport = {
  mode: QualityMode
  preset: QualityPreset
  root: string
  status: 'passed' | 'failed'
  durationMs: number
  coverage: {
    thresholds: CoverageThresholds
    exclusions: readonly CoverageExclusion[]
  }
  steps: readonly QualityStepResult[]
}
export type QualityExecutor = (
  command: string,
  options: { cwd: string; signal: AbortSignal }
) => Promise<number>

type RunQualityOptions = {
  root: string
  mode: QualityMode
  fix?: boolean
  since?: string
  signal?: AbortSignal
  config?: QualityConfig
  execute?: QualityExecutor
}

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
    project: {
      root: resolve(root, config.project?.root ?? '.'),
      source: config.project?.source ?? ['src/**/*.ts', 'src/**/*.js'],
      tests: config.project?.tests ?? [
        'test/**/*.test.ts',
        'src/**/*.test.ts',
        'test/**/*.test.js'
      ]
    },
    formatting: command(config.formatting, 'prettier --check .', toolsEnabled, {
      fixCommand: config.formatting?.fixCommand ?? 'prettier --write .'
    }),
    lint: command(config.lint, 'eslint .', toolsEnabled, {
      typed: config.lint?.typed ?? true,
      fixCommand: config.lint?.fixCommand ?? 'eslint . --fix'
    }),
    smells: command(config.smells, 'knip', toolsEnabled),
    typecheck: command(config.typecheck, 'tsc --noEmit', toolsEnabled),
    deadCode: command(config.deadCode, 'knip', toolsEnabled),
    dependencyCruiser: command(
      config.dependencyCruiser,
      'dependency-cruiser src --config dependency-cruiser.config.cjs',
      true
    ),
    tests: {
      unit: command(config.tests?.unit, 'vitest run', true),
      integration: command(config.tests?.integration, '', false),
      contract: command(config.tests?.contract, '', false),
      architecture: command(config.tests?.architecture, '', false)
    },
    coverage: {
      enabled: coverageEnabled,
      command: config.coverage?.command ?? coverageCommand(config, thresholds),
      thresholds: { ...thresholds, ...config.coverage?.thresholds },
      include: config.coverage?.include ?? ['src/**/*.{ts,js}'],
      exclude: config.coverage?.exclude ?? [],
      strictInclude: config.coverage?.strictInclude ?? []
    },
    build: command(config.build, 'npm run build --if-present', true),
    packageSmoke: command(config.packageSmoke, '', false)
  }
}

export async function runQuality(
  options: RunQualityOptions
): Promise<QualityReport> {
  const started = performance.now()
  const loaded = options.config ?? (await loadQualityConfig(options.root))
  const config = resolveQualityConfig(loaded, options.root)
  const signal = options.signal ?? new AbortController().signal
  const execute = options.execute ?? executeCommand
  const steps: QualityStepResult[] = []
  const commands =
    options.mode === 'fast'
      ? fastSteps(config, options)
      : fullSteps(config, options)

  for (const step of commands) {
    if (steps.some((result) => result.status === 'failed')) {
      steps.push({ name: step.name, status: 'skipped', durationMs: 0 })
      continue
    }
    if (signal.aborted) {
      steps.push({
        name: step.name,
        status: 'failed',
        durationMs: 0,
        exitCode: 130
      })
      continue
    }
    if (step.kind === 'analysis') {
      const stepStarted = performance.now()
      const analysis = await analyzeProject(config.project.root)
      steps.push({
        name: step.name,
        status: analysis.diagnostics.length === 0 ? 'passed' : 'failed',
        durationMs: elapsed(stepStarted),
        diagnostics: analysis.diagnostics
      })
      continue
    }
    if (!step.enabled || step.command.trim() === '') {
      steps.push({ name: step.name, status: 'skipped', durationMs: 0 })
      continue
    }
    const stepStarted = performance.now()
    const exitCode = await execute(step.command, {
      cwd: config.project.root,
      signal
    })
    steps.push({
      name: step.name,
      command: step.command,
      status: exitCode === 0 ? 'passed' : 'failed',
      durationMs: elapsed(stepStarted),
      exitCode
    })
  }

  return {
    mode: options.mode,
    preset: config.preset,
    root: config.project.root,
    status: steps.some((step) => step.status === 'failed')
      ? 'failed'
      : 'passed',
    durationMs: elapsed(started),
    coverage: {
      thresholds: config.coverage.thresholds,
      exclusions: config.coverage.exclude
    },
    steps
  }
}

function fastSteps(
  config: ResolvedQualityConfig,
  options: Pick<RunQualityOptions, 'fix' | 'since'>
): Step[] {
  const suffix =
    options.since === undefined ? '' : ` --changed ${shellQuote(options.since)}`
  return [
    external(
      'format',
      config.formatting,
      options.fix ? config.formatting.fixCommand : config.formatting.command
    ),
    external(
      config.lint.typed ? 'typed-lint' : 'lint',
      config.lint,
      options.fix ? config.lint.fixCommand : config.lint.command
    ),
    external('typecheck', config.typecheck),
    { name: 'architecture', kind: 'analysis' },
    external(
      'unit-tests',
      config.tests.unit,
      `${config.tests.unit.command}${suffix}`
    )
  ]
}

function fullSteps(
  config: ResolvedQualityConfig,
  options: Pick<RunQualityOptions, 'fix'>
): Step[] {
  return [
    external(
      'format',
      config.formatting,
      options.fix ? config.formatting.fixCommand : config.formatting.command
    ),
    external(
      config.lint.typed ? 'typed-lint' : 'lint',
      config.lint,
      options.fix ? config.lint.fixCommand : config.lint.command
    ),
    external('code-smells', config.smells),
    external('typecheck', config.typecheck),
    external('dead-code', config.deadCode),
    external('dependency-cruiser', config.dependencyCruiser),
    { name: 'architecture', kind: 'analysis' },
    external('unit-tests', config.tests.unit),
    external('integration-tests', config.tests.integration),
    external('contract-tests', config.tests.contract),
    external('architecture-tests', config.tests.architecture),
    {
      name: 'coverage',
      kind: 'external',
      enabled: config.coverage.enabled,
      command: config.coverage.command
    },
    external('build', config.build),
    external('package-smoke', config.packageSmoke)
  ]
}

type Step =
  | { name: string; kind: 'analysis' }
  | { name: string; kind: 'external'; enabled: boolean; command: string }

function external(
  name: string,
  config: QualityCommand,
  commandOverride?: string
): Step {
  return {
    name,
    kind: 'external',
    enabled: config.enabled !== false,
    command: commandOverride ?? config.command
  }
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
  const include =
    config.preset === 'strict'
      ? (config.coverage?.strictInclude ?? [])
      : (config.coverage?.include ?? ['src/**/*.{ts,js}'])
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

function validateQualityConfig(config: QualityConfig): void {
  if (!['off', 'standard', 'strict'].includes(config.preset)) {
    throw new Error(`Unknown quality preset: ${String(config.preset)}`)
  }
  for (const exclusion of config.coverage?.exclude ?? []) {
    if (exclusion.pattern.trim() === '' || exclusion.reason.trim() === '') {
      throw new Error('Coverage exclusions require a pattern and a reason')
    }
  }
  const thresholds = config.coverage?.thresholds
  if (thresholds !== undefined) {
    for (const [name, value] of Object.entries(thresholds)) {
      if (value < 0 || value > 100) {
        throw new Error(`Coverage threshold ${name} must be between 0 and 100`)
      }
    }
  }
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

async function executeCommand(
  command: string,
  options: { cwd: string; signal: AbortSignal }
): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      stdio: 'inherit'
    })
    const abort = () => child.kill('SIGTERM')
    options.signal.addEventListener('abort', abort, { once: true })
    child.once('error', () => resolvePromise(70))
    child.once('exit', (code, signal) => {
      options.signal.removeEventListener('abort', abort)
      resolvePromise(
        code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 70)
      )
    })
  })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started)
}
