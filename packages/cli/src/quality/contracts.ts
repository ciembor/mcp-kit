import type { ProjectDiagnostic } from '../analysis/project-analysis.js'

export type QualityPreset = 'off' | 'standard' | 'strict'
export type QualityMode = 'fast' | 'full' | 'release'
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

export type ReleaseGitStatusResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type ReleaseGitStatus = (
  root: string,
  signal: AbortSignal
) => Promise<ReleaseGitStatusResult>

export type RunQualityOptions = {
  root: string
  mode: QualityMode
  fix?: boolean
  since?: string
  signal?: AbortSignal
  config?: QualityConfig
  execute?: QualityExecutor
  gitStatus?: ReleaseGitStatus
}
