import { runCli } from './app/run-cli.js'
export { runCli }

export {
  analyzeProject,
  type ProjectAnalysis,
  type ProjectDiagnostic
} from './project-analysis.js'
export {
  defineQualityConfig,
  loadQualityConfig,
  resolveQualityConfig,
  runQuality,
  type CoverageExclusion,
  type CoverageThresholds,
  type QualityConfig,
  type QualityExecutor,
  type QualityMode,
  type QualityPreset,
  type QualityReport,
  type QualityStepResult,
  type ResolvedQualityConfig
} from './quality.js'
export {
  exitCodes,
  packageInfo,
  type AgentPreset,
  type CliIo,
  type CliResult,
  type DoctorDiagnostic,
  type ExitCode,
  type FileOperation,
  type FileOperationKind,
  type FilePlan,
  type JsonObject,
  type JsonValue,
  type PackageManager,
  type ProjectLanguage,
  type TransportPreset
} from './cli-contracts.js'
