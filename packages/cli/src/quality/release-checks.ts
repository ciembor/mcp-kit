import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { ProjectDiagnostic } from '../project-analysis.js'
import type { RunQualityOptions } from './contracts.js'
import type { ReleaseCheckName } from './steps.js'
import {
  checkNpmPack,
  checkPackageExports,
  checkPackageFiles,
  checkVersions
} from './release-checks-package-validations.js'
import {
  cleanupPreparedRelease,
  prepareInstalledReleasePackages,
  runInstalledCliSmoke,
  runInstalledImportSmoke,
  runInstalledTypeSmoke
} from './release-checks-install.js'
import {
  httpSmokeSource,
  stdioServerSource,
  stdioSmokeSource,
  supportsHttpSmoke,
  supportsStdioSmoke
} from './release-checks-smoke.js'
import { releasePackageManifests } from './release-checks-manifests.js'
import {
  dirtyPath,
  readGitStatus,
  releaseDiagnostic,
  runCommand,
  sanitizeMessage
} from './release-checks-support.js'

export async function runReleaseCheck(
  check: ReleaseCheckName,
  context: {
    root: string
    signal: AbortSignal
    gitStatus?: RunQualityOptions['gitStatus']
    npmPack?: RunQualityOptions['npmPack']
    npmInstall?: RunQualityOptions['npmInstall']
  }
): Promise<readonly ProjectDiagnostic[]> {
  return releaseCheckHandlers[check](context)
}

const releaseCheckHandlers: Record<
  ReleaseCheckName,
  (context: {
    root: string
    signal: AbortSignal
    gitStatus?: RunQualityOptions['gitStatus']
    npmPack?: RunQualityOptions['npmPack']
    npmInstall?: RunQualityOptions['npmInstall']
  }) => Promise<readonly ProjectDiagnostic[]>
> = {
  'clean-git': ({ root, signal, gitStatus }) =>
    checkCleanGit(root, signal, gitStatus),
  version: ({ root }) => checkVersions(root),
  changelog: ({ root }) => checkChangelog(root),
  'package-exports': ({ root }) => checkPackageExports(root),
  'package-files': ({ root }) => checkPackageFiles(root),
  'npm-pack': ({ root, signal, npmPack }) =>
    checkNpmPack(root, signal, npmPack),
  'install-packages': ({ root, signal, npmPack, npmInstall }) =>
    checkPackedInstall(root, signal, npmInstall, npmPack),
  'package-usage': ({ root, signal, npmPack, npmInstall }) =>
    checkPackageUsage(root, signal, npmPack, npmInstall),
  'stdio-smoke': ({ root, signal, npmPack, npmInstall }) =>
    checkStdioSmoke(root, signal, npmPack, npmInstall),
  'http-smoke': ({ root, signal, npmPack, npmInstall }) =>
    checkHttpSmoke(root, signal, npmPack, npmInstall)
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

  const versionSection = await versionSectionCandidates(root)
  if (versionSection.some((section) => text.includes(section))) return []

  return [
    releaseDiagnostic(
      'release-changelog',
      'CHANGELOG.md',
      'CHANGELOG.md must include an Unreleased or current version section'
    )
  ]
}

async function checkPackedInstall(
  root: string,
  signal: AbortSignal,
  npmInstall: RunQualityOptions['npmInstall'],
  npmPack: RunQualityOptions['npmPack']
): Promise<readonly ProjectDiagnostic[]> {
  const prepared = await prepareInstalledReleasePackages(root, signal, {
    npmInstall,
    npmPack
  })
  try {
    return prepared.diagnostics
  } finally {
    await cleanupPreparedRelease(prepared)
  }
}

async function checkPackageUsage(
  root: string,
  signal: AbortSignal,
  npmPack: RunQualityOptions['npmPack'],
  npmInstall: RunQualityOptions['npmInstall']
): Promise<readonly ProjectDiagnostic[]> {
  const prepared = await prepareInstalledReleasePackages(root, signal, {
    npmPack,
    npmInstall
  })
  try {
    if (prepared.diagnostics.length > 0) return prepared.diagnostics
    if (!('installDirectory' in prepared)) return prepared.diagnostics

    const importDiagnostics = await runInstalledImportSmoke(
      prepared.installDirectory,
      prepared.manifests,
      signal
    )
    if (importDiagnostics.length > 0) return importDiagnostics

    const typeDiagnostics = await runInstalledTypeSmoke(
      prepared.installDirectory,
      prepared.manifests,
      signal
    )
    if (typeDiagnostics.length > 0) return typeDiagnostics

    return runInstalledCliSmoke(
      prepared.installDirectory,
      prepared.manifests,
      signal
    )
  } finally {
    await cleanupPreparedRelease(prepared)
  }
}

async function checkStdioSmoke(
  root: string,
  signal: AbortSignal,
  npmPack: RunQualityOptions['npmPack'],
  npmInstall: RunQualityOptions['npmInstall']
): Promise<readonly ProjectDiagnostic[]> {
  const releasePackages = await releasePackageManifests(root)
  if (!supportsStdioSmoke(releasePackages)) return []

  const prepared = await prepareInstalledReleasePackages(root, signal, {
    npmPack,
    npmInstall
  })
  try {
    if (prepared.diagnostics.length > 0) return prepared.diagnostics
    if (!('installDirectory' in prepared)) return prepared.diagnostics

    const serverPath = resolve(prepared.installDirectory, 'stdio-server.mjs')
    const smokePath = resolve(prepared.installDirectory, 'stdio-smoke.mjs')
    await writeFile(serverPath, stdioServerSource())
    await writeFile(smokePath, stdioSmokeSource(serverPath))
    return runScriptSmoke({
      signal,
      installDirectory: prepared.installDirectory,
      scriptPath: smokePath,
      rule: 'release-stdio-smoke',
      file: 'stdio-smoke.mjs',
      label: 'Packaged stdio smoke failed',
      fallback: 'stdio smoke failed'
    })
  } finally {
    await cleanupPreparedRelease(prepared)
  }
}

async function checkHttpSmoke(
  root: string,
  signal: AbortSignal,
  npmPack: RunQualityOptions['npmPack'],
  npmInstall: RunQualityOptions['npmInstall']
): Promise<readonly ProjectDiagnostic[]> {
  const releasePackages = await releasePackageManifests(root)
  if (!supportsHttpSmoke(releasePackages)) return []

  const prepared = await prepareInstalledReleasePackages(root, signal, {
    npmPack,
    npmInstall
  })
  try {
    if (prepared.diagnostics.length > 0) return prepared.diagnostics
    if (!('installDirectory' in prepared)) return prepared.diagnostics

    const scriptPath = resolve(prepared.installDirectory, 'http-smoke.mjs')
    await writeFile(scriptPath, httpSmokeSource())
    return runScriptSmoke({
      signal,
      installDirectory: prepared.installDirectory,
      scriptPath,
      rule: 'release-http-smoke',
      file: 'http-smoke.mjs',
      label: 'Packaged HTTP smoke failed',
      fallback: 'http smoke failed'
    })
  } finally {
    await cleanupPreparedRelease(prepared)
  }
}

async function versionSectionCandidates(
  root: string
): Promise<readonly string[]> {
  const packageJson = await readFile(
    resolve(root, 'package.json'),
    'utf8'
  ).catch(() => undefined)
  if (packageJson === undefined) {
    return ['## [Unreleased]', '## Unreleased']
  }

  let version: unknown
  try {
    version = (JSON.parse(packageJson) as { version?: unknown }).version
  } catch {
    version = undefined
  }

  return [
    '## [Unreleased]',
    '## Unreleased',
    typeof version === 'string' ? `## [${version}]` : undefined,
    typeof version === 'string' ? `## ${version}` : undefined
  ].filter((value): value is string => value !== undefined)
}

async function runScriptSmoke(args: {
  signal: AbortSignal
  installDirectory: string
  scriptPath: string
  rule: string
  file: string
  label: string
  fallback: string
}): Promise<readonly ProjectDiagnostic[]> {
  const result = await runCommand('node', [args.scriptPath], {
    cwd: args.installDirectory,
    signal: args.signal
  })
  return result.exitCode === 0
    ? []
    : [
        releaseDiagnostic(
          args.rule,
          args.file,
          `${args.label}: ${sanitizeMessage(result.stderr || result.stdout, args.fallback)}`
        )
      ]
}
