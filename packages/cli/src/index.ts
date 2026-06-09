import { getBoolean, parseArgs } from './cli-args.js'
import {
  addCapability,
  createNewProject,
  doctorProject,
  initProject,
  qualityProject
} from './cli-commands.js'
import { isSupportedNodeVersion, nodeVersionDiagnostic } from './cli-doctor.js'
import {
  applyPlan,
  createOrMergeOperation,
  detectLanguage,
  detectPackageManager,
  detectProjectContext,
  detectProjectRoot,
  exists,
  findTemplateDirectory,
  readJsonFile,
  safeReaddir
} from './cli-files.js'
import {
  buildManifest,
  mergeManifestFiles,
  planAddCapability,
  planGeneratedProject
} from './cli-plan.js'
import {
  agentFiles,
  renderJavaScriptTooling,
  renderMain,
  renderPackageJson
} from './cli-render.js'
import { errorMessage, toPackageName } from './cli-utils.js'
import { CliError } from './cli-error.js'
import {
  exitCodes,
  type CliIo,
  type CliResult,
  type ParsedArgs
} from './cli-contracts.js'

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

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  io: CliIo = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  const cwd = io.cwd ?? process.cwd()
  const parsed = parseArgs(args)
  const json = getBoolean(parsed, 'json')

  try {
    const result = await dispatch(parsed, cwd)
    writeResult(result, { json, stdout, stderr })
    return result.exitCode ?? exitCodes.ok
  } catch (error) {
    const cliError = normalizeCliError(error)
    writeError(cliError, { json, stdout, stderr })
    return cliError.exitCode
  }
}

async function dispatch(parsed: ParsedArgs, cwd: string): Promise<CliResult> {
  const command = parsed.command
  const handlers: Record<string, () => Promise<CliResult>> = {
    new: () => createNewProject(parsed, cwd),
    init: () => initProject(parsed, cwd),
    add: () => addCapability(parsed, cwd),
    doctor: () => doctorProject(parsed, cwd),
    quality: () => qualityProject(parsed, cwd)
  }
  if (command === undefined || ['help', '--help', '-h'].includes(command)) {
    return { command: 'help' }
  }
  const handler = handlers[command]
  if (handler !== undefined) return handler()
  throw new CliError(
    `Unknown command "${command}". Expected new, init, add, doctor or quality.`,
    exitCodes.usage
  )
}

function writeResult(
  result: CliResult,
  io: {
    json: boolean
    stdout: Pick<NodeJS.WriteStream, 'write'>
    stderr: Pick<NodeJS.WriteStream, 'write'>
  }
): void {
  if (io.json) {
    writeJsonResult(result, io.stdout)
    return
  }
  if (writeInformationalResult(result, io.stdout)) return
  const count = result.plan!.operations.length
  io.stderr.write(
    `${result.command}: planned ${count} file operations in ${result.root}\n`
  )
}

function normalizeCliError(error: unknown): CliError {
  return error instanceof CliError
    ? error
    : new CliError(errorMessage(error), exitCodes.internal)
}

function writeError(
  error: CliError,
  io: {
    json: boolean
    stdout: Pick<NodeJS.WriteStream, 'write'>
    stderr: Pick<NodeJS.WriteStream, 'write'>
  }
): void {
  const output = io.json ? io.stdout : io.stderr
  const message = io.json
    ? JSON.stringify({
        ok: false,
        error: { message: error.message, exitCode: error.exitCode }
      })
    : `mcp-kit: ${error.message}`
  output.write(`${message}\n`)
}

function writeJsonResult(
  result: CliResult,
  stdout: Pick<NodeJS.WriteStream, 'write'>
): void {
  stdout.write(
    `${JSON.stringify({ ok: result.quality?.status !== 'failed', ...result })}\n`
  )
}

function writeInformationalResult(
  result: CliResult,
  stdout: Pick<NodeJS.WriteStream, 'write'>
): boolean {
  if (result.command === 'help') {
    stdout.write(helpText())
    return true
  }
  if (result.command === 'doctor') {
    for (const diagnostic of result.diagnostics!) {
      stdout.write(
        `[${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}\n`
      )
    }
    return true
  }
  if (result.command !== 'quality') return false
  writeQualityResult(result, stdout)
  return true
}

function writeQualityResult(
  result: CliResult,
  stdout: Pick<NodeJS.WriteStream, 'write'>
): void {
  for (const step of result.quality!.steps) {
    stdout.write(
      `[${step.status}] ${step.name} ${formatDuration(step.durationMs)}\n`
    )
    for (const diagnostic of step.diagnostics ?? []) {
      const location =
        diagnostic.line === undefined
          ? diagnostic.file
          : `${diagnostic.file}:${diagnostic.line}`
      stdout.write(`  ${location} ${diagnostic.rule}: ${diagnostic.message}\n`)
    }
  }
  for (const exclusion of result.quality!.coverage.exclusions) {
    stdout.write(
      `[coverage-exclusion] ${exclusion.pattern}: ${exclusion.reason}\n`
    )
  }
  stdout.write(
    `quality ${result.quality!.status} in ${formatDuration(result.quality!.durationMs)}\n`
  )
}

function helpText(): string {
  return `Usage: mcp-kit <command>\n\nCommands:\n  new <name>\n  init\n  add tool|resource|prompt <name>\n  doctor\n  quality --fast|--full [--fix] [--since <git-ref>] [--json]\n`
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(1)}s`
}

export const internals = {
  parseArgs,
  planGeneratedProject,
  planAddCapability,
  applyPlan,
  detectProjectRoot,
  detectProjectContext,
  createOrMergeOperation,
  detectLanguage,
  detectPackageManager,
  safeReaddir,
  exists,
  readJsonFile,
  errorMessage,
  isSupportedNodeVersion,
  nodeVersionDiagnostic,
  buildManifest,
  mergeManifestFiles,
  agentFiles,
  findTemplateDirectory,
  renderMain,
  renderJavaScriptTooling,
  renderPackageJson,
  toPackageName
}
