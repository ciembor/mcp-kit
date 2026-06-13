import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { getBoolean } from '../cli-args.js'
import {
  exitCodes,
  type CliResult,
  type ExitCode,
  type PackageManager,
  type ParsedArgs
} from '../cli-contracts.js'
import { CliError } from '../cli-error.js'
import { detectPackageManager, detectProjectRoot } from '../cli-files.js'
import { executeCommand, runQuality } from '../quality.js'

type ReleaseDependencies = {
  runQuality?: typeof runQuality
  execute?: typeof executeCommand
  gitBranch?: typeof readCurrentBranch
}

export async function prepareRelease(
  parsed: ParsedArgs,
  cwd: string,
  dependencies: ReleaseDependencies = {}
): Promise<CliResult> {
  assertReleaseArgs(parsed)

  const context = await createReleaseContext(cwd, dependencies)
  try {
    return await runReleasePreparation(
      context,
      getBoolean(parsed, 'publish'),
      performance.now()
    )
  } finally {
    process.removeListener('SIGINT', context.interrupt)
    process.removeListener('SIGTERM', context.interrupt)
  }
}

type ReleaseContext = {
  root: string
  controller: AbortController
  interrupt: () => void
  qualityRunner: typeof runQuality
  commandExecutor: typeof executeCommand
  gitBranch: typeof readCurrentBranch
}

async function readCurrentBranch(
  root: string,
  signal: AbortSignal
): Promise<string> {
  const result = await runCommand(
    'git',
    ['branch', '--show-current'],
    root,
    signal
  )
  if (result.exitCode !== 0) {
    throw new CliError(
      `Could not determine the current git branch: ${result.stderr || 'unknown error'}`,
      exitCodes.validation
    )
  }
  return result.stdout.trim()
}

async function readRootVersion(root: string): Promise<string | undefined> {
  const packageJson = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8')
  ) as { version?: unknown }
  return typeof packageJson.version === 'string'
    ? packageJson.version
    : undefined
}

function releasePublishCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'pnpm':
      return 'corepack pnpm publish -r --access public --provenance'
    case 'npm':
    case 'yarn':
    case 'bun':
      return 'npm publish --workspaces --access public --provenance'
  }
}

async function runCommand(
  program: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(program, [...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    const abort = () => child.kill('SIGTERM')
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      signal.removeEventListener('abort', abort)
      resolvePromise({
        exitCode: 70,
        stdout,
        stderr: error instanceof Error ? error.message : String(error)
      })
    })
    child.once('exit', (code, exitSignal) => {
      signal.removeEventListener('abort', abort)
      resolvePromise({
        exitCode: commandExitCode(code, exitSignal),
        stdout,
        stderr
      })
    })
  })
}

function commandExitCode(
  code: number | null,
  exitSignal: NodeJS.Signals | null
): number {
  if (code !== null) return code
  if (exitSignal === 'SIGINT') return 130
  if (exitSignal === 'SIGTERM') return 143
  return 70
}

function assertReleaseArgs(parsed: ParsedArgs): void {
  const unsupportedOptions = Object.keys(parsed.options).filter(
    (option) => option !== 'json' && option !== 'publish'
  )
  if (parsed.positionals.length > 0 || unsupportedOptions.length > 0) {
    throw new CliError('Usage: mcp-kit release [--publish]', exitCodes.usage)
  }
}

async function createReleaseContext(
  cwd: string,
  dependencies: ReleaseDependencies
): Promise<ReleaseContext> {
  const root = await detectProjectRoot(cwd, false)
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)

  return {
    root,
    controller,
    interrupt,
    qualityRunner: dependencies.runQuality ?? runQuality,
    commandExecutor: dependencies.execute ?? executeCommand,
    gitBranch: dependencies.gitBranch ?? readCurrentBranch
  }
}

async function runReleasePreparation(
  context: ReleaseContext,
  publish: boolean,
  started: number
): Promise<CliResult> {
  const quality = await context.qualityRunner({
    root: context.root,
    mode: 'release',
    signal: context.controller.signal
  })
  if (quality.status !== 'passed') {
    return releaseResult(
      {
        root: context.root,
        quality,
        status: 'failed',
        exitCode: exitCodes.validation
      },
      started
    )
  }

  if (!publish) {
    return releaseResult(
      {
        root: context.root,
        quality,
        status: 'prepared',
        exitCode: exitCodes.ok
      },
      started
    )
  }

  return publishRelease(context, quality, started)
}

async function publishRelease(
  context: ReleaseContext,
  quality: Awaited<ReturnType<typeof runQuality>>,
  started: number
): Promise<CliResult> {
  await assertPublishableRelease(context)
  const publishCommand = releasePublishCommand(
    detectPackageManager(context.root)
  )
  const publishExitCode = await context.commandExecutor(publishCommand, {
    cwd: context.root,
    signal: context.controller.signal
  })
  return releaseResult(
    {
      root: context.root,
      quality,
      status: publishExitCode === 0 ? 'published' : 'failed',
      exitCode: publishExitCode === 0 ? exitCodes.ok : exitCodes.validation
    },
    started
  )
}

async function assertPublishableRelease(
  context: ReleaseContext
): Promise<void> {
  const currentBranch = await context.gitBranch(
    context.root,
    context.controller.signal
  )
  if (currentBranch !== 'main') {
    const branchLabel = currentBranch === '' ? 'detached HEAD' : currentBranch
    throw new CliError(
      `Release publishing is only allowed from main, received ${branchLabel}`,
      exitCodes.validation
    )
  }

  const version = await readRootVersion(context.root)
  if (version === '0.0.0') {
    throw new CliError(
      'Release publishing requires a real root package version instead of 0.0.0',
      exitCodes.validation
    )
  }
}

function releaseResult(
  result: {
    root: string
    quality: Awaited<ReturnType<typeof runQuality>>
    status: 'failed' | 'prepared' | 'published'
    exitCode: ExitCode
  },
  started: number
): CliResult {
  return {
    command: 'release',
    root: result.root,
    quality: result.quality,
    release: {
      status: result.status,
      durationMs: Math.round(performance.now() - started)
    },
    exitCode: result.exitCode
  }
}
