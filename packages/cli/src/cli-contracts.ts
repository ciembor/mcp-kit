import type { QualityPreset, QualityReport } from './quality.js'

export const packageInfo = {
  name: '@mcp-kit/cli',
  version: '0.0.0'
} as const

export const exitCodes = {
  ok: 0,
  usage: 1,
  validation: 2,
  conflict: 3,
  internal: 70
} as const

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes]
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'
export type ProjectLanguage = 'typescript' | 'javascript'
export type TransportPreset = 'stdio' | 'http' | 'both'
export type AgentPreset = 'none' | 'generic' | 'claude' | 'cursor' | 'codex'
export type FileOperationKind =
  | 'create'
  | 'overwrite'
  | 'merge-json'
  | 'merge-yaml'
  | 'merge-package'
  | 'conflict'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject

export type JsonObject = {
  [key: string]: JsonValue
}

export type FileOperation = {
  kind: FileOperationKind
  path: string
  content?: string
  merge?: JsonObject
}

export type FilePlan = {
  root: string
  operations: readonly FileOperation[]
}

export type DoctorDiagnostic = {
  level: 'ok' | 'warning' | 'error'
  code: string
  message: string
}

export type CliResult = {
  command: string
  root?: string
  plan?: FilePlan
  diagnostics?: readonly DoctorDiagnostic[]
  quality?: QualityReport
  release?: {
    status: 'prepared' | 'published' | 'failed'
    durationMs: number
  }
  exitCode?: ExitCode
}

export type CliIo = {
  cwd?: string
  argv?: readonly string[]
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  stderr?: Pick<NodeJS.WriteStream, 'write'>
}

export type ProjectContext = {
  root: string
  packageManager: PackageManager
  language: ProjectLanguage
  gitRoot?: string
}

export type ParsedArgs = {
  command?: string
  positionals: string[]
  options: Record<string, string | boolean>
}

export type GeneratorOptions = {
  transport: TransportPreset
  quality: QualityPreset
  language: ProjectLanguage
  packageManager: PackageManager
  git: boolean
  hooks: boolean
  ci: boolean
  install: boolean
  agent: AgentPreset
  force: boolean
  dryRun: boolean
}

export type CapabilityInput = {
  kind: 'tool' | 'resource' | 'prompt'
  feature: string
  symbol: string
  ext: 'ts' | 'js'
  async?: boolean
}

export type CapabilityRegistrationInput = Pick<
  CapabilityInput,
  'kind' | 'feature' | 'ext' | 'async'
>
