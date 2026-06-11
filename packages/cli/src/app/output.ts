import { errorMessage } from '../cli-utils.js'
import { CliError } from '../cli-error.js'
import { exitCodes, type CliResult } from '../cli-contracts.js'

type ResultWriter = Pick<NodeJS.WriteStream, 'write'>

export function normalizeCliError(error: unknown): CliError {
  return error instanceof CliError
    ? error
    : new CliError(errorMessage(error), exitCodes.internal)
}

export function writeResult(
  result: CliResult,
  io: {
    json: boolean
    stdout: ResultWriter
    stderr: ResultWriter
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

export function writeError(
  error: CliError,
  io: {
    json: boolean
    stdout: ResultWriter
    stderr: ResultWriter
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

function writeJsonResult(result: CliResult, stdout: ResultWriter): void {
  stdout.write(
    `${JSON.stringify({
      ok:
        result.quality?.status !== 'failed' &&
        result.release?.status !== 'failed',
      ...result
    })}\n`
  )
}

function writeInformationalResult(
  result: CliResult,
  stdout: ResultWriter
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
  if (result.command !== 'quality' && result.command !== 'release') return false
  writeQualityResult(result, stdout)
  if (result.command === 'release') {
    stdout.write(
      `release ${result.release!.status} in ${formatDuration(result.release!.durationMs)}\n`
    )
  }
  return true
}

function writeQualityResult(result: CliResult, stdout: ResultWriter): void {
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
  return `Usage: mcp-kit <command>\n\nCommands:\n  new <name>\n  init\n  add tool|resource|prompt <name>\n  doctor\n  quality --fast|--full|--release|--mutation [--fix] [--since <git-ref>] [--json]\n  release [--publish] [--json]\n`
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(1)}s`
}
