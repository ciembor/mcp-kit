import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { isJsonObject } from '../cli-utils.js'
import type { ProjectDiagnostic } from '../project-analysis.js'
import { releaseDiagnostic, relativePath } from './release-checks-support.js'

export type WorkspacePackageManifest = {
  name: string
  version: string
  private?: boolean
  path: string
  directory: string
  exports?: unknown
  bin?: unknown
  files?: unknown
}

export type PackageManifest = {
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

export async function releasePackageManifests(
  root: string
): Promise<readonly WorkspacePackageManifest[]> {
  return (await readWorkspacePackages(root)).filter(
    (manifest) => manifest.private !== true
  )
}

export async function readPackageManifest(
  path: string
): Promise<PackageManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    return isJsonObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

export async function packageInfoDiagnostics(
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

export function packageVersion(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  const json = JSON.stringify(value)
  return json ?? String(value)
}

export function exportTargets(exportsField: unknown): readonly string[] {
  return collectPathTargets(exportsField)
}

export function binTargets(binField: unknown): readonly string[] {
  return collectPathTargets(binField)
}

export function exportSpecifiers(
  manifest: WorkspacePackageManifest
): readonly string[] {
  if (!isJsonObject(manifest.exports)) return [manifest.name]

  return Object.keys(manifest.exports)
    .filter((key) => key === '.' || key.startsWith('./'))
    .map((key) =>
      key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`
    )
}

export function normalizePublishPath(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value
}

export function coversPublishedPath(entry: string, target: string): boolean {
  return entry === target || target.startsWith(`${trimTrailingSlash(entry)}/`)
}

export function isSemver(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  )
}

function collectPathTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPathTargets(entry))
  }
  if (!isJsonObject(value)) return []
  return Object.values(value).flatMap((entry) => collectPathTargets(entry))
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
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

      const version = packageVersion(manifest.version)
      if (version === undefined) {
        return undefined
      }

      return {
        name: manifest.name,
        version,
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
