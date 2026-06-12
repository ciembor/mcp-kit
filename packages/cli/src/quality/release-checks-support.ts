import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type {
  ReleaseGitStatusResult,
  ReleaseNpmInstallResult,
  ReleaseNpmPackResult
} from './contracts.js'
import type { ProjectDiagnostic } from '../project-analysis.js'

export function releaseDiagnostic(
  rule: string,
  file: string,
  message: string
): ProjectDiagnostic {
  return { rule, file, message }
}

export function dirtyPath(entry: string): string {
  if (entry.length <= 3) return '.'
  const path = entry.slice(3)
  if (path.includes(' -> ')) {
    return path.split(' -> ').at(-1) ?? path
  }
  return path
}

export function sanitizeMessage(message: string, fallback: string): string {
  const normalized = message.trim()
  return normalized === '' ? fallback : normalized
}

export function relativePath(root: string, absolute: string): string {
  return absolute.startsWith(`${root}/`)
    ? absolute.slice(root.length + 1)
    : absolute
}

export async function readGitStatus(
  root: string,
  signal: AbortSignal
): Promise<ReleaseGitStatusResult> {
  return runCommand('git', ['status', '--short'], { cwd: root, signal })
}

export async function runNpmPack(
  packageRoot: string,
  signal: AbortSignal
): Promise<ReleaseNpmPackResult> {
  return runCommand(
    'npm',
    ['pack', '--json', '--dry-run'],
    { cwd: packageRoot, signal },
    {
      env: npmCommandEnvironment()
    }
  )
}

export async function runNpmPackArchive(
  packageRoot: string,
  tarballDirectory: string,
  signal: AbortSignal
): Promise<ReleaseNpmPackResult> {
  return runCommand(
    'npm',
    ['pack', '--json', '--pack-destination', tarballDirectory],
    { cwd: packageRoot, signal },
    { env: npmCommandEnvironment() }
  )
}

export async function runNpmInstall(
  installRoot: string,
  tarballs: readonly string[],
  signal: AbortSignal
): Promise<ReleaseNpmInstallResult> {
  return runCommand(
    'npm',
    ['install', '--ignore-scripts', '--no-package-lock', ...tarballs],
    { cwd: installRoot, signal },
    { env: npmCommandEnvironment() }
  )
}

export async function runCommand(
  program: string,
  args: readonly string[],
  execution: { cwd: string; signal: AbortSignal },
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(program, [...args], {
      cwd: execution.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env:
        options.env === undefined
          ? process.env
          : { ...process.env, ...options.env }
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
    execution.signal.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      execution.signal.removeEventListener('abort', abort)
      resolvePromise({
        exitCode: 70,
        stdout,
        stderr: error instanceof Error ? error.message : String(error)
      })
    })
    child.once('exit', (code, exitSignal) => {
      execution.signal.removeEventListener('abort', abort)
      resolvePromise({
        exitCode: code ?? exitCodeFromSignal(exitSignal),
        stdout,
        stderr
      })
    })
  })
}

function npmCommandEnvironment(): NodeJS.ProcessEnv {
  const base = resolve(tmpdir(), 'mcp-kit-npm')
  return {
    HOME: base,
    npm_config_cache: resolve(base, 'cache'),
    npm_config_logs_dir: resolve(base, 'logs')
  }
}

function exitCodeFromSignal(exitSignal: NodeJS.Signals | null): number {
  if (exitSignal === 'SIGINT') return 130
  if (exitSignal === 'SIGTERM') return 143
  return 70
}
