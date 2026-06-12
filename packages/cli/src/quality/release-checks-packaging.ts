import { cp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { isJsonObject } from '../cli-utils.js'
import type { ProjectDiagnostic } from '../project-analysis.js'
import type { RunQualityOptions } from './contracts.js'
import type {
  PackageManifest,
  WorkspacePackageManifest
} from './release-checks-manifests.js'
import { isSemver, readPackageManifest } from './release-checks-manifests.js'
import {
  releaseDiagnostic,
  runNpmPackArchive,
  sanitizeMessage
} from './release-checks-support.js'

export async function packReleasePackages(args: {
  root: string
  manifests: readonly WorkspacePackageManifest[]
  tarballDirectory: string
  stagingDirectory: string
  signal: AbortSignal
  npmPack?: RunQualityOptions['npmPack']
}): Promise<{
  tarballs: readonly string[]
  diagnostics: readonly ProjectDiagnostic[]
}> {
  const tarballs: string[] = []
  const diagnostics: ProjectDiagnostic[] = []
  const versions = new Map(
    args.manifests.map((manifest) => [manifest.name, manifest.version])
  )

  for (const manifest of args.manifests) {
    const stagedRoot = resolve(
      args.stagingDirectory,
      manifest.name.replaceAll('/', '__')
    )
    const staged = await createPackStage({
      root: args.root,
      manifest,
      targetRoot: stagedRoot,
      versions
    })
    if (staged.diagnostics.length > 0) {
      diagnostics.push(...staged.diagnostics)
      continue
    }

    const packed = await packDirectory(
      stagedRoot,
      args.tarballDirectory,
      args.signal,
      args.npmPack
    )
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

function rewriteWorkspaceManifest(
  manifest: PackageManifest,
  versions: ReadonlyMap<string, string>,
  manifestPath: string
): { manifest: PackageManifest; diagnostics: readonly ProjectDiagnostic[] } {
  const diagnostics: ProjectDiagnostic[] = []
  const rewritten: PackageManifest = { ...manifest }

  for (const field of dependencyFields) {
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

async function createPackStage(args: {
  root: string
  manifest: WorkspacePackageManifest
  targetRoot: string
  versions: ReadonlyMap<string, string>
}): Promise<{ diagnostics: readonly ProjectDiagnostic[] }> {
  const packageRoot = resolve(args.root, args.manifest.directory)
  await mkdir(args.targetRoot, { recursive: true })

  const stagedFiles = await stagePublishedFiles(
    args.manifest,
    packageRoot,
    args.targetRoot
  )
  if (stagedFiles !== undefined) {
    return { diagnostics: [stagedFiles] }
  }

  return await stagePackageManifest(args, packageRoot)
}

async function packDirectory(
  packageRoot: string,
  tarballDirectory: string,
  signal: AbortSignal,
  npmPack?: RunQualityOptions['npmPack']
): Promise<{
  tarballs: readonly string[]
  diagnostics: readonly ProjectDiagnostic[]
}> {
  const result =
    npmPack === undefined
      ? await runNpmPackArchive(packageRoot, tarballDirectory, signal)
      : await npmPack(packageRoot, signal)
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

  const tarballs = tarballsFromPackOutput(result.stdout, tarballDirectory)
  if (tarballs === undefined) {
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

function publishableFiles(
  manifest: WorkspacePackageManifest
): readonly string[] | undefined {
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.some((entry) => typeof entry !== 'string')
  ) {
    return undefined
  }
  return manifest.files.map((entry) => String(entry))
}

async function stagePublishedFiles(
  manifest: WorkspacePackageManifest,
  packageRoot: string,
  targetRoot: string
): Promise<ProjectDiagnostic | undefined> {
  const files = publishableFiles(manifest)
  if (files === undefined) {
    return releaseDiagnostic(
      'release-install-packages',
      manifest.path,
      `Package ${manifest.name} must define a string files array before packing`
    )
  }

  for (const relative of files) {
    try {
      await cp(resolve(packageRoot, relative), resolve(targetRoot, relative), {
        recursive: true
      })
    } catch (error) {
      return releaseDiagnostic(
        'release-install-packages',
        manifest.path,
        `Cannot stage ${relative} for ${manifest.name}: ${sanitizeMessage(String(error), 'copy failed')}`
      )
    }
  }

  return undefined
}

async function stagePackageManifest(
  args: {
    manifest: WorkspacePackageManifest
    targetRoot: string
    versions: ReadonlyMap<string, string>
  },
  packageRoot: string
): Promise<{ diagnostics: readonly ProjectDiagnostic[] }> {
  const packageJson = await readPackageManifest(
    resolve(packageRoot, 'package.json')
  )
  if (packageJson === undefined) {
    return {
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          args.manifest.path,
          'package.json is missing or invalid'
        )
      ]
    }
  }

  const rewritten = rewriteWorkspaceManifest(
    packageJson,
    args.versions,
    args.manifest.path
  )
  if (rewritten.diagnostics.length > 0) return rewritten

  await writeFile(
    resolve(args.targetRoot, 'package.json'),
    `${JSON.stringify(rewritten.manifest, null, 2)}\n`
  )
  return { diagnostics: [] }
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

function tarballsFromPackOutput(
  output: string,
  tarballDirectory: string
): readonly string[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(output) as unknown
  } catch {
    return undefined
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return undefined
  }

  const tarballs = parsed.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry['filename'] !== 'string') {
      return []
    }
    return [resolve(tarballDirectory, entry['filename'])]
  })

  return tarballs.length === 0 ? undefined : tarballs
}

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
] as const satisfies readonly (keyof PackageManifest)[]
