import { resolve } from 'node:path'

import { isJsonObject } from '../cli-utils.js'
import type { ProjectDiagnostic } from '../project-analysis.js'
import type { RunQualityOptions } from './contracts.js'
import {
  binTargets,
  coversPublishedPath,
  displayValue,
  exportTargets,
  isSemver,
  normalizePublishPath,
  packageInfoDiagnostics,
  packageVersion,
  readPackageManifest,
  releasePackageManifests
} from './release-checks-manifests.js'
import {
  releaseDiagnostic,
  runNpmPack,
  sanitizeMessage
} from './release-checks-support.js'

export async function checkVersions(
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

  const rootVersion = packageVersion(rootPackage.version)
  if (rootVersion === undefined) {
    diagnostics.push(
      releaseDiagnostic(
        'release-version',
        'package.json',
        `Root package version must be a concrete semver value, received "${displayValue(rootPackage.version)}"`
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
    if (rootVersion !== undefined && manifest.version !== rootVersion) {
      diagnostics.push(
        releaseDiagnostic(
          'release-version',
          manifest.path,
          `Package ${manifest.name} version ${manifest.version} must match root version ${rootVersion}`
        )
      )
    }
    diagnostics.push(...(await packageInfoDiagnostics(root, manifest)))
  }

  return diagnostics
}

export async function checkPackageExports(
  root: string
): Promise<readonly ProjectDiagnostic[]> {
  const releasePackages = await releasePackageManifests(root)
  return releasePackages.flatMap((manifest) =>
    manifestExportDiagnostics(manifest)
  )
}

export async function checkPackageFiles(
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

export async function checkNpmPack(
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

function manifestExportDiagnostics(manifest: {
  name: string
  path: string
  exports?: unknown
  bin?: unknown
}): readonly ProjectDiagnostic[] {
  const exportsValidation = validateExportsMap(manifest)
  if (exportsValidation !== undefined) return [exportsValidation]

  return [
    ...publishTargetDiagnostics({
      file: manifest.path,
      packageName: manifest.name,
      targets: exportTargets(manifest.exports),
      label: 'export target'
    }),
    ...publishTargetDiagnostics({
      file: manifest.path,
      packageName: manifest.name,
      targets: binTargets(manifest.bin),
      label: 'bin target'
    })
  ]
}

function validateExportsMap(manifest: {
  name: string
  path: string
  exports?: unknown
}): ProjectDiagnostic | undefined {
  if (!isJsonObject(manifest.exports)) {
    return releaseDiagnostic(
      'release-package-exports',
      manifest.path,
      `Package ${manifest.name} must define an exports map`
    )
  }

  const rootExport = manifest.exports['.']
  if (!isJsonObject(rootExport)) {
    return releaseDiagnostic(
      'release-package-exports',
      manifest.path,
      `Package ${manifest.name} must define a root "." export with import and types`
    )
  }

  if (
    typeof rootExport['import'] !== 'string' ||
    typeof rootExport['types'] !== 'string'
  ) {
    return releaseDiagnostic(
      'release-package-exports',
      manifest.path,
      `Package ${manifest.name} root export must define string import and types targets`
    )
  }

  return undefined
}

function publishTargetDiagnostics(args: {
  file: string
  packageName: string
  targets: readonly string[]
  label: string
}): readonly ProjectDiagnostic[] {
  return args.targets.flatMap((target) =>
    target.startsWith('./dist/')
      ? []
      : [
          releaseDiagnostic(
            'release-package-exports',
            args.file,
            `Package ${args.packageName} ${args.label} ${target} must stay under ./dist/`
          )
        ]
  )
}
