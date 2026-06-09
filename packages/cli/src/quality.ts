import { analyzeProject, type ProjectDiagnostic } from './project-analysis.js'
import {
  loadQualityConfig,
  resolveQualityConfig,
  shellQuote
} from './quality-config.js'
import { executeCommand } from './quality-execute.js'

export {
  defineQualityConfig,
  loadQualityConfig,
  resolveQualityConfig
} from './quality-config.js'

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
export type QualityCommand = {
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
  mutation?: QualityCommand
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
  mutation: QualityCommand
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
    external('package-smoke', config.packageSmoke),
    external('mutation', config.mutation)
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

function elapsed(started: number): number {
  return Math.round(performance.now() - started)
}
