import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import type { Dirent } from 'node:fs'
import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import type { ProjectDiagnostic } from '../analysis/project-analysis.js'
import { isJsonObject } from '../cli-utils.js'
import type {
  ReleaseGitStatusResult,
  ReleaseNpmInstallResult,
  ReleaseNpmPackResult,
  RunQualityOptions
} from './contracts.js'
import type { ReleaseCheckName } from './steps.js'

type WorkspacePackageManifest = {
  name: string
  version: string
  private?: boolean
  path: string
  directory: string
  exports?: unknown
  bin?: unknown
  files?: unknown
}

type PackageManifest = {
  name?: unknown
  version?: unknown
  private?: unknown
  exports?: unknown
  bin?: unknown
  files?: unknown
  dependencies?: unknown
  devDependencies?: unknown
  peerDependencies?: unknown
  optionalDependencies?: unknown
}

type PreparedRelease =
  | {
      tempRoot: string
      diagnostics: readonly ProjectDiagnostic[]
    }
  | {
      tempRoot: string
      installDirectory: string
      manifests: readonly WorkspacePackageManifest[]
      diagnostics: readonly ProjectDiagnostic[]
    }

const require = createRequire(import.meta.url)
const typescriptCli = require.resolve('typescript/bin/tsc')

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
  switch (check) {
    case 'clean-git':
      return checkCleanGit(context.root, context.signal, context.gitStatus)
    case 'version':
      return checkVersions(context.root)
    case 'changelog':
      return checkChangelog(context.root)
    case 'package-exports':
      return checkPackageExports(context.root)
    case 'package-files':
      return checkPackageFiles(context.root)
    case 'npm-pack':
      return checkNpmPack(context.root, context.signal, context.npmPack)
    case 'install-packages':
      return checkPackedInstall(
        context.root,
        context.signal,
        context.npmInstall
      )
    case 'package-usage':
      return checkPackageUsage(context.root, context.signal)
    case 'stdio-smoke':
      return checkStdioSmoke(context.root, context.signal)
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

  const releasePackages = await releasePackageManifests(root)
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

async function checkPackageExports(
  root: string
): Promise<readonly ProjectDiagnostic[]> {
  const diagnostics: ProjectDiagnostic[] = []
  const releasePackages = await releasePackageManifests(root)

  for (const manifest of releasePackages) {
    if (!isJsonObject(manifest.exports)) {
      diagnostics.push(
        releaseDiagnostic(
          'release-package-exports',
          manifest.path,
          `Package ${manifest.name} must define an exports map`
        )
      )
      continue
    }

    const rootExport = manifest.exports['.']
    if (!isJsonObject(rootExport)) {
      diagnostics.push(
        releaseDiagnostic(
          'release-package-exports',
          manifest.path,
          `Package ${manifest.name} must define a root "." export with import and types`
        )
      )
      continue
    }

    if (
      typeof rootExport['import'] !== 'string' ||
      typeof rootExport['types'] !== 'string'
    ) {
      diagnostics.push(
        releaseDiagnostic(
          'release-package-exports',
          manifest.path,
          `Package ${manifest.name} root export must define string import and types targets`
        )
      )
      continue
    }

    for (const target of exportTargets(manifest.exports)) {
      if (!target.startsWith('./dist/')) {
        diagnostics.push(
          releaseDiagnostic(
            'release-package-exports',
            manifest.path,
            `Package ${manifest.name} export target ${target} must stay under ./dist/`
          )
        )
      }
    }

    for (const target of binTargets(manifest.bin)) {
      if (!target.startsWith('./dist/')) {
        diagnostics.push(
          releaseDiagnostic(
            'release-package-exports',
            manifest.path,
            `Package ${manifest.name} bin target ${target} must stay under ./dist/`
          )
        )
      }
    }
  }

  return diagnostics
}

async function checkPackageFiles(
  root: string
): Promise<readonly ProjectDiagnostic[]> {
  const diagnostics: ProjectDiagnostic[] = []
  const releasePackages = await releasePackageManifests(root)

  for (const manifest of releasePackages) {
    if (
      !Array.isArray(manifest.files) ||
      manifest.files.some((entry) => typeof entry !== 'string')
    ) {
      diagnostics.push(
        releaseDiagnostic(
          'release-package-files',
          manifest.path,
          `Package ${manifest.name} must define a files array`
        )
      )
      continue
    }

    const files = manifest.files
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizePublishPath(entry))

    if (!files.includes('README.md')) {
      diagnostics.push(
        releaseDiagnostic(
          'release-package-files',
          manifest.path,
          `Package ${manifest.name} files must include README.md`
        )
      )
    }

    const targets = [
      ...exportTargets(manifest.exports),
      ...binTargets(manifest.bin)
    ].map((target) => normalizePublishPath(target))

    for (const target of targets) {
      if (!files.some((entry) => coversPublishedPath(entry, target))) {
        diagnostics.push(
          releaseDiagnostic(
            'release-package-files',
            manifest.path,
            `Package ${manifest.name} files must include ${target}`
          )
        )
      }
    }
  }

  return diagnostics
}

async function checkNpmPack(
  root: string,
  signal: AbortSignal,
  npmPack: RunQualityOptions['npmPack']
): Promise<readonly ProjectDiagnostic[]> {
  const diagnostics: ProjectDiagnostic[] = []
  const releasePackages = await releasePackageManifests(root)

  for (const manifest of releasePackages) {
    const packageRoot = resolve(root, manifest.directory)
    const result = await (npmPack ?? runNpmPack)(packageRoot, signal)
    if (result.exitCode !== 0) {
      diagnostics.push(
        releaseDiagnostic(
          'release-npm-pack',
          manifest.path,
          `npm pack failed for ${manifest.name}: ${sanitizeMessage(result.stderr, 'unknown error')}`
        )
      )
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout) as unknown
    } catch {
      diagnostics.push(
        releaseDiagnostic(
          'release-npm-pack',
          manifest.path,
          `npm pack must return JSON output for ${manifest.name}`
        )
      )
      continue
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      diagnostics.push(
        releaseDiagnostic(
          'release-npm-pack',
          manifest.path,
          `npm pack must report at least one packed artifact for ${manifest.name}`
        )
      )
    }
  }

  return diagnostics
}

async function checkPackedInstall(
  root: string,
  signal: AbortSignal,
  npmInstall: RunQualityOptions['npmInstall']
): Promise<readonly ProjectDiagnostic[]> {
  const prepared = await prepareInstalledReleasePackages(
    root,
    signal,
    npmInstall
  )
  try {
    return prepared.diagnostics
  } finally {
    await cleanupPreparedRelease(prepared)
  }
}

async function checkPackageUsage(
  root: string,
  signal: AbortSignal
): Promise<readonly ProjectDiagnostic[]> {
  const prepared = await prepareInstalledReleasePackages(root, signal)
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
  signal: AbortSignal
): Promise<readonly ProjectDiagnostic[]> {
  const releasePackages = await releasePackageManifests(root)
  if (!supportsStdioSmoke(releasePackages)) return []

  const prepared = await prepareInstalledReleasePackages(root, signal)
  try {
    if (prepared.diagnostics.length > 0) return prepared.diagnostics
    if (!('installDirectory' in prepared)) return prepared.diagnostics

    const serverPath = resolve(prepared.installDirectory, 'stdio-server.mjs')
    const smokePath = resolve(prepared.installDirectory, 'stdio-smoke.mjs')
    await writeFile(serverPath, stdioServerSource())
    await writeFile(smokePath, stdioSmokeSource(serverPath))
    const result = await runCommand(
      'node',
      [smokePath],
      prepared.installDirectory,
      signal
    )
    return result.exitCode === 0
      ? []
      : [
          releaseDiagnostic(
            'release-stdio-smoke',
            'stdio-smoke.mjs',
            `Packaged stdio smoke failed: ${sanitizeMessage(result.stderr || result.stdout, 'stdio smoke failed')}`
          )
        ]
  } finally {
    await cleanupPreparedRelease(prepared)
  }
}

async function prepareInstalledReleasePackages(
  root: string,
  signal: AbortSignal,
  npmInstall?: RunQualityOptions['npmInstall']
): Promise<PreparedRelease> {
  const manifests = await releasePackageManifests(root)
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-install-'))
  const tarballDirectory = resolve(tempRoot, 'tarballs')
  const stagingDirectory = resolve(tempRoot, 'staged')
  const installDirectory = resolve(tempRoot, 'install')
  await mkdir(tarballDirectory, { recursive: true })
  await mkdir(stagingDirectory, { recursive: true })
  await mkdir(installDirectory, { recursive: true })

  const packed = await packReleasePackages(
    root,
    manifests,
    tarballDirectory,
    stagingDirectory,
    signal
  )
  if (packed.diagnostics.length > 0) {
    return { tempRoot, diagnostics: packed.diagnostics }
  }

  await writeFile(
    resolve(installDirectory, 'package.json'),
    `${JSON.stringify({ name: 'mcp-kit-release-install', private: true }, null, 2)}\n`
  )

  const result = await (npmInstall ?? runNpmInstall)(
    installDirectory,
    packed.tarballs,
    signal
  )
  if (result.exitCode !== 0) {
    return {
      tempRoot,
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          'package.json',
          `npm install failed for packed release tarballs: ${sanitizeMessage(result.stderr, 'unknown error')}`
        )
      ]
    }
  }

  return { tempRoot, installDirectory, manifests, diagnostics: [] }
}

async function cleanupPreparedRelease(
  prepared: PreparedRelease
): Promise<void> {
  await rm(prepared.tempRoot, { recursive: true, force: true })
}

async function packReleasePackages(
  root: string,
  manifests: readonly WorkspacePackageManifest[],
  tarballDirectory: string,
  stagingDirectory: string,
  signal: AbortSignal
): Promise<{
  tarballs: readonly string[]
  diagnostics: readonly ProjectDiagnostic[]
}> {
  const tarballs: string[] = []
  const diagnostics: ProjectDiagnostic[] = []
  const versions = new Map(
    manifests.map((manifest) => [manifest.name, manifest.version])
  )

  for (const manifest of manifests) {
    const stagedRoot = resolve(
      stagingDirectory,
      manifest.name.replaceAll('/', '__')
    )
    const staged = await createPackStage(root, manifest, stagedRoot, versions)
    if (staged.diagnostics.length > 0) {
      diagnostics.push(...staged.diagnostics)
      continue
    }

    const packed = await packDirectory(stagedRoot, tarballDirectory, signal)
    if (packed.diagnostics.length > 0) {
      diagnostics.push(
        ...packed.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          file: manifest.path
        }))
      )
      continue
    }

    tarballs.push(...packed.tarballs)
  }

  return { tarballs, diagnostics }
}

async function createPackStage(
  root: string,
  manifest: WorkspacePackageManifest,
  targetRoot: string,
  versions: ReadonlyMap<string, string>
): Promise<{ diagnostics: readonly ProjectDiagnostic[] }> {
  const packageRoot = resolve(root, manifest.directory)
  await mkdir(targetRoot, { recursive: true })

  if (
    !Array.isArray(manifest.files) ||
    manifest.files.some((entry) => typeof entry !== 'string')
  ) {
    return {
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          manifest.path,
          `Package ${manifest.name} must define a string files array before packing`
        )
      ]
    }
  }

  for (const entry of manifest.files) {
    const relative = String(entry)
    try {
      await cp(resolve(packageRoot, relative), resolve(targetRoot, relative), {
        recursive: true
      })
    } catch (error) {
      return {
        diagnostics: [
          releaseDiagnostic(
            'release-install-packages',
            manifest.path,
            `Cannot stage ${relative} for ${manifest.name}: ${sanitizeMessage(String(error), 'copy failed')}`
          )
        ]
      }
    }
  }

  const packageJson = await readPackageManifest(
    resolve(packageRoot, 'package.json')
  )
  if (packageJson === undefined) {
    return {
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          manifest.path,
          'package.json is missing or invalid'
        )
      ]
    }
  }

  const rewritten = rewriteWorkspaceManifest(
    packageJson,
    versions,
    manifest.path
  )
  if (rewritten.diagnostics.length > 0) return rewritten

  await writeFile(
    resolve(targetRoot, 'package.json'),
    `${JSON.stringify(rewritten.manifest, null, 2)}\n`
  )
  return { diagnostics: [] }
}

function rewriteWorkspaceManifest(
  manifest: PackageManifest,
  versions: ReadonlyMap<string, string>,
  manifestPath: string
): { manifest: PackageManifest; diagnostics: readonly ProjectDiagnostic[] } {
  const diagnostics: ProjectDiagnostic[] = []
  const rewritten: PackageManifest = { ...manifest }

  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies'
  ] as const) {
    const resolved = rewriteDependencyMap(
      rewritten[field],
      versions,
      manifestPath
    )
    rewritten[field] = resolved.map
    diagnostics.push(...resolved.diagnostics)
  }

  return { manifest: rewritten, diagnostics }
}

function rewriteDependencyMap(
  input: unknown,
  versions: ReadonlyMap<string, string>,
  manifestPath: string
): { map: unknown; diagnostics: readonly ProjectDiagnostic[] } {
  if (!isJsonObject(input)) {
    return { map: input, diagnostics: [] }
  }

  const rewritten: Record<string, unknown> = {}
  const diagnostics: ProjectDiagnostic[] = []

  for (const [dependency, range] of Object.entries(input)) {
    if (typeof range !== 'string' || !range.startsWith('workspace:')) {
      rewritten[dependency] = range
      continue
    }

    const resolved = resolveWorkspaceRange(range, dependency, versions)
    if (resolved === undefined) {
      diagnostics.push(
        releaseDiagnostic(
          'release-install-packages',
          manifestPath,
          `Cannot rewrite workspace dependency ${dependency} from ${range}`
        )
      )
      rewritten[dependency] = range
      continue
    }
    rewritten[dependency] = resolved
  }

  return { map: rewritten, diagnostics }
}

function resolveWorkspaceRange(
  range: string,
  dependency: string,
  versions: ReadonlyMap<string, string>
): string | undefined {
  const version = versions.get(dependency)
  if (version === undefined) return undefined
  const suffix = range.slice('workspace:'.length)
  if (suffix === '' || suffix === '*') return version
  if (suffix === '^' || suffix === '~') return `${suffix}${version}`
  if (isSemver(suffix)) return suffix
  return version
}

async function packDirectory(
  packageRoot: string,
  tarballDirectory: string,
  signal: AbortSignal
): Promise<{
  tarballs: readonly string[]
  diagnostics: readonly ProjectDiagnostic[]
}> {
  const result = await runNpmPackArchive(packageRoot, tarballDirectory, signal)
  if (result.exitCode !== 0) {
    return {
      tarballs: [],
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          'package.json',
          `npm pack failed while preparing install tarballs: ${sanitizeMessage(result.stderr, 'unknown error')}`
        )
      ]
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout) as unknown
  } catch {
    return {
      tarballs: [],
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          'package.json',
          'npm pack must return JSON output while preparing install tarballs'
        )
      ]
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      tarballs: [],
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          'package.json',
          'npm pack must report at least one packed tarball'
        )
      ]
    }
  }

  const tarballs = parsed.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry['filename'] !== 'string') {
      return []
    }
    return [resolve(tarballDirectory, entry['filename'])]
  })

  if (tarballs.length === 0) {
    return {
      tarballs: [],
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          'package.json',
          'npm pack JSON output did not contain filenames'
        )
      ]
    }
  }

  return { tarballs, diagnostics: [] }
}

async function runInstalledImportSmoke(
  installDirectory: string,
  manifests: readonly WorkspacePackageManifest[],
  signal: AbortSignal
): Promise<readonly ProjectDiagnostic[]> {
  const specifiers = manifests.flatMap(exportSpecifiers)
  if (specifiers.length === 0) return []

  const source = specifiers
    .map((specifier) => `await import(${JSON.stringify(specifier)})`)
    .join('\n')
  const scriptPath = resolve(installDirectory, 'imports.mjs')
  await writeFile(scriptPath, `${source}\n`)
  const result = await runCommand(
    'node',
    [scriptPath],
    installDirectory,
    signal
  )

  return result.exitCode === 0
    ? []
    : [
        releaseDiagnostic(
          'release-package-usage',
          'imports.mjs',
          `Installed package imports failed: ${sanitizeMessage(result.stderr, 'node import failed')}`
        )
      ]
}

async function runInstalledTypeSmoke(
  installDirectory: string,
  manifests: readonly WorkspacePackageManifest[],
  signal: AbortSignal
): Promise<readonly ProjectDiagnostic[]> {
  const specifiers = manifests.flatMap(exportSpecifiers)
  if (specifiers.length === 0) return []

  const source = specifiers
    .map(
      (specifier, index) =>
        `import { packageInfo as packageInfo${index} } from ${JSON.stringify(specifier)}\n` +
        `const packageName${index}: string = packageInfo${index}.name\n` +
        `void packageName${index}\n`
    )
    .join('\n')
  const configPath = resolve(installDirectory, 'tsconfig.json')
  const sourcePath = resolve(installDirectory, 'types-smoke.ts')
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true
        },
        include: ['types-smoke.ts']
      },
      null,
      2
    )}\n`
  )
  await writeFile(sourcePath, source)
  const result = await runCommand(
    'node',
    [typescriptCli, '--project', configPath],
    installDirectory,
    signal
  )

  return result.exitCode === 0
    ? []
    : [
        releaseDiagnostic(
          'release-package-usage',
          'types-smoke.ts',
          `Installed package types failed: ${sanitizeMessage(result.stderr || result.stdout, 'tsc failed')}`
        )
      ]
}

async function runInstalledCliSmoke(
  installDirectory: string,
  manifests: readonly WorkspacePackageManifest[],
  signal: AbortSignal
): Promise<readonly ProjectDiagnostic[]> {
  const diagnostics: ProjectDiagnostic[] = []

  for (const manifest of manifests) {
    for (const target of binTargets(manifest.bin)) {
      const result = await runCommand(
        'node',
        [
          resolve(
            installDirectory,
            'node_modules',
            manifest.name,
            normalizePublishPath(target)
          ),
          '--help'
        ],
        installDirectory,
        signal
      )
      if (result.exitCode !== 0) {
        diagnostics.push(
          releaseDiagnostic(
            'release-package-usage',
            manifest.path,
            `Installed CLI smoke failed for ${manifest.name}: ${sanitizeMessage(result.stderr || result.stdout, 'cli failed')}`
          )
        )
      }
    }
  }

  return diagnostics
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

async function releasePackageManifests(
  root: string
): Promise<readonly WorkspacePackageManifest[]> {
  return (await readWorkspacePackages(root)).filter(
    (manifest) => manifest.private !== true
  )
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
        directory: `packages/${entry}`,
        exports: manifest.exports,
        bin: manifest.bin,
        files: manifest.files
      } satisfies WorkspacePackageManifest
    })
  )

  return manifests.filter((manifest) => manifest !== undefined)
}

async function readPackageManifest(
  path: string
): Promise<PackageManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    return isJsonObject(value) ? (value as PackageManifest) : undefined
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

function exportTargets(exportsField: unknown): readonly string[] {
  return collectPathTargets(exportsField)
}

function binTargets(binField: unknown): readonly string[] {
  return collectPathTargets(binField)
}

function exportSpecifiers(
  manifest: WorkspacePackageManifest
): readonly string[] {
  if (!isJsonObject(manifest.exports)) return [manifest.name]

  return Object.keys(manifest.exports)
    .filter((key) => key === '.' || key.startsWith('./'))
    .map((key) =>
      key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`
    )
}

function supportsStdioSmoke(
  manifests: readonly WorkspacePackageManifest[]
): boolean {
  const names = new Set(manifests.map((manifest) => manifest.name))
  return (
    names.has('@mcp-kit/core') &&
    names.has('@mcp-kit/node') &&
    names.has('@mcp-kit/testing')
  )
}

function stdioServerSource(): string {
  return `import { z } from 'zod'
import { createMcpApp, defineTool } from '@mcp-kit/core'
import { runStdio } from '@mcp-kit/node'

const health = defineTool({
  name: 'health',
  inputSchema: z.object({}),
  handler: () => ({
    content: [{ type: 'text', text: 'ok' }]
  })
})

const app = createMcpApp({
  name: 'packaged-stdio-smoke',
  version: '1.0.0',
  services: {}
})

app.tools([health])
await runStdio(app)
`
}

function stdioSmokeSource(serverPath: string): string {
  return `import { connectStdioTestClient } from '@mcp-kit/testing'

const client = await connectStdioTestClient({
  command: process.execPath,
  args: [${JSON.stringify(serverPath)}]
})

try {
  const result = await client.client.callTool({
    name: 'health',
    arguments: {}
  })
  if (result.content?.[0]?.type !== 'text' || result.content[0].text !== 'ok') {
    throw new Error('unexpected health result')
  }
} finally {
  await client.close()
}
`
}

function collectPathTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPathTargets(entry))
  }
  if (!isJsonObject(value)) return []
  return Object.values(value).flatMap((entry) => collectPathTargets(entry))
}

function normalizePublishPath(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value
}

function coversPublishedPath(entry: string, target: string): boolean {
  return entry === target || target.startsWith(`${trimTrailingSlash(entry)}/`)
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
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
  return runCommand('git', ['status', '--short'], root, signal)
}

async function runNpmPack(
  packageRoot: string,
  signal: AbortSignal
): Promise<ReleaseNpmPackResult> {
  return runCommand('npm', ['pack', '--json', '--dry-run'], packageRoot, signal)
}

async function runNpmPackArchive(
  packageRoot: string,
  tarballDirectory: string,
  signal: AbortSignal
): Promise<ReleaseNpmPackResult> {
  return runCommand(
    'npm',
    ['pack', '--json', '--pack-destination', tarballDirectory],
    packageRoot,
    signal
  )
}

async function runNpmInstall(
  installRoot: string,
  tarballs: readonly string[],
  signal: AbortSignal
): Promise<ReleaseNpmInstallResult> {
  return runCommand(
    'npm',
    ['install', '--ignore-scripts', '--no-package-lock', ...tarballs],
    installRoot,
    signal
  )
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
