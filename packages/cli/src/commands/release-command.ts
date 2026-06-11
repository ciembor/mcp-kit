import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { getBoolean } from '../cli-args.js'
import {
  exitCodes,
  type CliResult,
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
  const unsupportedOptions = Object.keys(parsed.options).filter(
    (option) => option !== 'json' && option !== 'publish'
  )
  if (parsed.positionals.length > 0 || unsupportedOptions.length > 0) {
    throw new CliError('Usage: mcp-kit release [--publish]', exitCodes.usage)
  }

  const root = await detectProjectRoot(cwd, false)
  const publish = getBoolean(parsed, 'publish')
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)

  const started = performance.now()
  try {
    const qualityRunner = dependencies.runQuality ?? runQuality
    const commandExecutor = dependencies.execute ?? executeCommand
    const quality = await qualityRunner({
      root,
      mode: 'release',
      signal: controller.signal
    })
    if (quality.status !== 'passed') {
      return {
        command: 'release',
        root,
        quality,
        release: {
          status: 'failed',
          durationMs: Math.round(performance.now() - started)
        },
        exitCode: exitCodes.validation
      }
    }

    if (!publish) {
      return {
        command: 'release',
        root,
        quality,
        release: {
          status: 'prepared',
          durationMs: Math.round(performance.now() - started)
        },
        exitCode: exitCodes.ok
      }
    }

    const currentBranch = await (dependencies.gitBranch ?? readCurrentBranch)(
      root,
      controller.signal
    )
    if (currentBranch !== 'main') {
      throw new CliError(
        `Release publishing is only allowed from main, received ${currentBranch === '' ? 'detached HEAD' : currentBranch}`,
        exitCodes.validation
      )
    }

    const version = await readRootVersion(root)
    if (version === '0.0.0') {
      throw new CliError(
        'Release publishing requires a real root package version instead of 0.0.0',
        exitCodes.validation
      )
    }

    const publishCommand = releasePublishCommand(detectPackageManager(root))
    const publishExitCode = await commandExecutor(publishCommand, {
      cwd: root,
      signal: controller.signal
    })
    return {
      command: 'release',
      root,
      quality,
      release: {
        status: publishExitCode === 0 ? 'published' : 'failed',
        durationMs: Math.round(performance.now() - started)
      },
      exitCode: publishExitCode === 0 ? exitCodes.ok : exitCodes.validation
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
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
        exitCode:
          code ??
          (exitSignal === 'SIGINT' ? 130 : exitSignal === 'SIGTERM' ? 143 : 70),
        stdout,
        stderr
      })
    })
  })
}
