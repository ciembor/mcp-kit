import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

import type { ProjectDiagnostic } from '../analysis/project-analysis.js'
import { isJsonObject } from '../cli-utils.js'
import type {
  ReleaseGitStatus,
  ReleaseGitStatusResult,
  RunQualityOptions
} from './contracts.js'
import type { ReleaseCheckName } from './steps.js'

export async function runReleaseCheck(
  check: ReleaseCheckName,
  context: {
    root: string
    signal: AbortSignal
    gitStatus?: RunQualityOptions['gitStatus']
  }
): Promise<readonly ProjectDiagnostic[]> {
  switch (check) {
    case 'clean-git':
      return checkCleanGit(context.root, context.signal, context.gitStatus)
    case 'version':
      return checkVersions(context.root)
    case 'changelog':
      return checkChangelog(context.root)
  }
}

async function checkCleanGit(
  root: string,
  signal: AbortSignal,
  gitStatus: RunQualityOptions['gitStatus']
): Promise<readonly ProjectDiagnostic[]> {
  const result = await (gitStatus ?? readGitStatus)(root, signal)
  if (result.exitCode !== 0) {
    return [
      releaseDiagnostic(
        'release-clean-git',
        '.git',
        sanitizeMessage(result.stderr, 'Git status check failed')
      )
    ]
  }
  const entries = result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
  if (entries.length === 0) return []
  return entries.map((entry) =>
    releaseDiagnostic(
      'release-clean-git',
      dirtyPath(entry),
      `Release requires a clean git worktree: ${entry}`
    )
  )
}

async function checkVersions(
  root: string
): Promise<readonly ProjectDiagnostic[]> {
  const diagnostics: ProjectDiagnostic[] = []
  const rootPackage = await readPackageManifest(resolve(root, 'package.json'))
  if (rootPackage === undefined) {
    return [
      releaseDiagnostic(
        'release-version',
        'package.json',
        'package.json is missing or invalid'
      )
    ]
  }

  if (!isSemver(rootPackage.version)) {
    diagnostics.push(
      releaseDiagnostic(
        'release-version',
        'package.json',
        `Root package version must be a concrete semver value, received "${String(rootPackage.version)}"`
      )
    )
  }

  const workspacePackages = await readWorkspacePackages(root)
  const releasePackages = workspacePackages.filter(
    (manifest) => manifest.private !== true
  )

  for (const manifest of releasePackages) {
    if (!isSemver(manifest.version)) {
      diagnostics.push(
        releaseDiagnostic(
          'release-version',
          manifest.path,
          `Package ${manifest.name} must declare a concrete semver version, received "${String(manifest.version)}"`
        )
      )
      continue
    }
    if (manifest.version !== rootPackage.version) {
      diagnostics.push(
        releaseDiagnostic(
          'release-version',
          manifest.path,
          `Package ${manifest.name} version ${manifest.version} must match root version ${rootPackage.version}`
        )
      )
    }
    diagnostics.push(...(await packageInfoDiagnostics(root, manifest)))
  }

  return diagnostics
}

async function checkChangelog(
  root: string
): Promise<readonly ProjectDiagnostic[]> {
  const changelogPath = resolve(root, 'CHANGELOG.md')
  let text: string
  try {
    text = await readFile(changelogPath, 'utf8')
  } catch {
    return [
      releaseDiagnostic(
        'release-changelog',
        'CHANGELOG.md',
        'CHANGELOG.md is required for release quality'
      )
    ]
  }
  if (text.trim() === '') {
    return [
      releaseDiagnostic(
        'release-changelog',
        'CHANGELOG.md',
        'CHANGELOG.md cannot be empty'
      )
    ]
  }

  const rootPackage = await readPackageManifest(resolve(root, 'package.json'))
  const version = rootPackage?.version
  const acceptedSections = [
    '## [Unreleased]',
    '## Unreleased',
    typeof version === 'string' ? `## [${version}]` : undefined,
    typeof version === 'string' ? `## ${version}` : undefined
  ].filter((value): value is string => value !== undefined)

  if (acceptedSections.some((section) => text.includes(section))) return []

  return [
    releaseDiagnostic(
      'release-changelog',
      'CHANGELOG.md',
      `CHANGELOG.md must include an Unreleased or ${String(version)} section`
    )
  ]
}

async function packageInfoDiagnostics(
  root: string,
  manifest: WorkspacePackageManifest
): Promise<readonly ProjectDiagnostic[]> {
  const sourceRoot = resolve(root, manifest.directory, 'src')
  const packageInfoFile = await findPackageInfoFile(sourceRoot)
  if (packageInfoFile === undefined) {
    return [
      releaseDiagnostic(
        'release-version',
        manifest.path,
        `Package ${manifest.name} must export packageInfo with name and version`
      )
    ]
  }
  const source = await readFile(packageInfoFile, 'utf8')
  const match = source.match(
    /export const packageInfo\s*=\s*{\s*name:\s*'([^']+)',\s*version:\s*'([^']+)'/s
  )
  if (match === null) {
    return [
      releaseDiagnostic(
        'release-version',
        relativePath(root, packageInfoFile),
        'packageInfo must declare literal name and version fields'
      )
    ]
  }
  const [, sourceName, sourceVersion] = match
  const diagnostics: ProjectDiagnostic[] = []
  if (sourceName !== manifest.name) {
    diagnostics.push(
      releaseDiagnostic(
        'release-version',
        relativePath(root, packageInfoFile),
        `packageInfo name ${sourceName} must match package.json name ${manifest.name}`
      )
    )
  }
  if (sourceVersion !== manifest.version) {
    diagnostics.push(
      releaseDiagnostic(
        'release-version',
        relativePath(root, packageInfoFile),
        `packageInfo version ${sourceVersion} must match package.json version ${manifest.version}`
      )
    )
  }
  return diagnostics
}

type WorkspacePackageManifest = {
  name: string
  version: string
  private?: boolean
  path: string
  directory: string
}

async function readWorkspacePackages(
  root: string
): Promise<readonly WorkspacePackageManifest[]> {
  const directory = resolve(root, 'packages')
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }
  const manifests = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry, 'package.json')
      const manifest = await readPackageManifest(path)
      if (manifest === undefined || typeof manifest.name !== 'string') {
        return undefined
      }
      return {
        name: manifest.name,
        version: String(manifest.version ?? ''),
        private: manifest.private === true,
        path: relativePath(root, path),
        directory: `packages/${entry}`
      } satisfies WorkspacePackageManifest
    })
  )
  return manifests.filter((manifest) => manifest !== undefined)
}

async function readPackageManifest(
  path: string
): Promise<
  { name?: unknown; version?: unknown; private?: unknown } | undefined
> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    return isJsonObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function findPackageInfoFile(
  directory: string
): Promise<string | undefined> {
  let entries: readonly Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return undefined
  }

  for (const entry of entries) {
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findPackageInfoFile(absolute)
      if (nested !== undefined) return nested
      continue
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue
    const source = await readFile(absolute, 'utf8')
    if (source.includes('export const packageInfo')) return absolute
  }
  return undefined
}

function dirtyPath(entry: string): string {
  if (entry.length <= 3) return '.'
  const path = entry.slice(3)
  if (path.includes(' -> ')) {
    return path.split(' -> ').at(-1) ?? path
  }
  return path
}

function releaseDiagnostic(
  rule: string,
  file: string,
  message: string
): ProjectDiagnostic {
  return { rule, file, message }
}

function relativePath(root: string, absolute: string): string {
  return absolute.startsWith(`${root}/`)
    ? absolute.slice(root.length + 1)
    : absolute
}

function sanitizeMessage(message: string, fallback: string): string {
  const normalized = message.trim()
  return normalized === '' ? fallback : normalized
}

function isSemver(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  )
}

async function readGitStatus(
  root: string,
  signal: AbortSignal
): Promise<ReleaseGitStatusResult> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', ['status', '--short'], {
      cwd: root,
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
