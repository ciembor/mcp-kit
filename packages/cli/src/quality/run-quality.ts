import { analyzeProject } from '../analysis/project-analysis.js'
import { loadQualityConfig, resolveQualityConfig } from './quality-config.js'
import { executeCommand } from './quality-execute.js'
import { runReleaseCheck } from './release-checks.js'
import type {
  QualityExecutor,
  QualityReport,
  QualityStepResult,
  RunQualityOptions
} from './contracts.js'
import { fastSteps, fullSteps, type Step } from './steps.js'

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
    const previousFailed = steps.some((result) => result.status === 'failed')
    steps.push(
      await executeStep(step, {
        root: config.project.root,
        signal,
        execute,
        previousFailed,
        gitStatus: options.gitStatus,
        npmPack: options.npmPack
      })
    )
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

async function executeStep(
  step: Step,
  context: {
    root: string
    signal: AbortSignal
    execute: QualityExecutor
    previousFailed: boolean
    gitStatus?: RunQualityOptions['gitStatus']
    npmPack?: RunQualityOptions['npmPack']
  }
): Promise<QualityStepResult> {
  if (context.previousFailed) return skippedStep(step.name)
  if (context.signal.aborted) {
    return { name: step.name, status: 'failed', durationMs: 0, exitCode: 130 }
  }
  if (step.kind === 'analysis') return executeAnalysis(step.name, context.root)
  if (step.kind === 'release-check') {
    return executeReleaseCheck(step.name, step.check, context)
  }
  if (!step.enabled || step.command.trim() === '') return skippedStep(step.name)
  return executeExternal(step, context)
}

async function executeAnalysis(
  name: string,
  root: string
): Promise<QualityStepResult> {
  const started = performance.now()
  const analysis = await analyzeProject(root)
  return {
    name,
    status: analysis.diagnostics.length === 0 ? 'passed' : 'failed',
    durationMs: elapsed(started),
    diagnostics: analysis.diagnostics
  }
}

async function executeExternal(
  step: Extract<Step, { kind: 'external' }>,
  context: {
    root: string
    signal: AbortSignal
    execute: QualityExecutor
  }
): Promise<QualityStepResult> {
  const started = performance.now()
  const exitCode = await context.execute(step.command, {
    cwd: context.root,
    signal: context.signal
  })
  return {
    name: step.name,
    command: step.command,
    status: exitCode === 0 ? 'passed' : 'failed',
    durationMs: elapsed(started),
    exitCode
  }
}

async function executeReleaseCheck(
  name: string,
  check: Extract<Step, { kind: 'release-check' }>['check'],
  context: {
    root: string
    signal: AbortSignal
    gitStatus?: RunQualityOptions['gitStatus']
    npmPack?: RunQualityOptions['npmPack']
  }
): Promise<QualityStepResult> {
  const started = performance.now()
  const diagnostics = await runReleaseCheck(check, context)
  return {
    name,
    status: diagnostics.length === 0 ? 'passed' : 'failed',
    durationMs: elapsed(started),
    diagnostics
  }
}

function skippedStep(name: string): QualityStepResult {
  return { name, status: 'skipped', durationMs: 0 }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started)
}
