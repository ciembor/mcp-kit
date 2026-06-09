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
    const cliError =
      error instanceof CliError
        ? error
        : new CliError(errorMessage(error), exitCodes.internal)

    if (json) {
      stdout.write(
        `${JSON.stringify({
          ok: false,
          error: {
            message: cliError.message,
            exitCode: cliError.exitCode
          }
        })}\n`
      )
    } else {
      stderr.write(`mcp-kit: ${cliError.message}\n`)
    }
    return cliError.exitCode
  }
}

async function dispatch(parsed: ParsedArgs, cwd: string): Promise<CliResult> {
  switch (parsed.command) {
    case 'new':
      return createNewProject(parsed, cwd)
    case 'init':
      return initProject(parsed, cwd)
    case 'add':
      return addCapability(parsed, cwd)
    case 'doctor':
      return doctorProject(parsed, cwd)
    case 'quality':
      return qualityProject(parsed, cwd)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return { command: 'help' }
    default:
      throw new CliError(
        `Unknown command "${parsed.command}". Expected new, init, add, doctor or quality.`,
        exitCodes.usage
      )
  }
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
    io.stdout.write(
      `${JSON.stringify({
        ok: result.quality?.status !== 'failed',
        ...result
      })}\n`
    )
    return
  }
  if (result.command === 'help') {
    io.stdout.write(helpText())
    return
  }
  if (result.command === 'doctor') {
    for (const diagnostic of result.diagnostics!) {
      io.stdout.write(
        `[${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}\n`
      )
    }
    return
  }
  if (result.command === 'quality') {
    for (const step of result.quality!.steps) {
      io.stdout.write(
        `[${step.status}] ${step.name} ${formatDuration(step.durationMs)}\n`
      )
      for (const diagnostic of step.diagnostics ?? []) {
        const location =
          diagnostic.line === undefined
            ? diagnostic.file
            : `${diagnostic.file}:${diagnostic.line}`
        io.stdout.write(
          `  ${location} ${diagnostic.rule}: ${diagnostic.message}\n`
        )
      }
    }
    for (const exclusion of result.quality!.coverage.exclusions) {
      io.stdout.write(
        `[coverage-exclusion] ${exclusion.pattern}: ${exclusion.reason}\n`
      )
    }
    io.stdout.write(
      `quality ${result.quality!.status} in ${formatDuration(result.quality!.durationMs)}\n`
    )
    return
  }
  const count = result.plan!.operations.length
  io.stderr.write(
    `${result.command}: planned ${count} file operations in ${result.root}\n`
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
