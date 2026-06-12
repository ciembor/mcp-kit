import { createRequire } from 'node:module'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import type { ProjectDiagnostic } from '../project-analysis.js'
import type { RunQualityOptions } from './contracts.js'
import {
  binTargets,
  exportSpecifiers,
  normalizePublishPath,
  releasePackageManifests,
  type WorkspacePackageManifest
} from './release-checks-manifests.js'
import { packReleasePackages } from './release-checks-packaging.js'
import { typeSmokeConfig, typeSmokeImportLine } from './release-checks-smoke.js'
import {
  releaseDiagnostic,
  runCommand,
  runNpmInstall,
  sanitizeMessage
} from './release-checks-support.js'

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

export async function prepareInstalledReleasePackages(
  root: string,
  signal: AbortSignal,
  options: {
    npmPack?: RunQualityOptions['npmPack']
    npmInstall?: RunQualityOptions['npmInstall']
  } = {}
): Promise<PreparedRelease> {
  const manifests = await releasePackageManifests(root)
  const layout = await createTempInstallLayout()

  const packed = await packReleasePackages({
    root,
    manifests,
    tarballDirectory: layout.tarballDirectory,
    stagingDirectory: layout.stagingDirectory,
    signal,
    npmPack: options.npmPack
  })
  if (packed.diagnostics.length > 0) {
    return { tempRoot: layout.tempRoot, diagnostics: packed.diagnostics }
  }

  await writeFile(
    resolve(layout.installDirectory, 'package.json'),
    `${JSON.stringify({ name: 'mcp-kit-release-install', private: true }, null, 2)}\n`
  )

  if (options.npmInstall !== undefined) {
    return await prepareSyntheticInstalledRelease({
      root,
      tempRoot: layout.tempRoot,
      installDirectory: layout.installDirectory,
      manifests,
      npmInstall: options.npmInstall,
      signal
    })
  }

  return await installPackedRelease({
    tempRoot: layout.tempRoot,
    installDirectory: layout.installDirectory,
    manifests,
    tarballs: packed.tarballs,
    signal
  })
}

export async function cleanupPreparedRelease(
  prepared: PreparedRelease
): Promise<void> {
  await rm(prepared.tempRoot, { recursive: true, force: true })
}

async function createTempInstallLayout() {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-install-'))
  const tarballDirectory = resolve(tempRoot, 'tarballs')
  const stagingDirectory = resolve(tempRoot, 'staged')
  const installDirectory = resolve(tempRoot, 'install')
  await mkdir(tarballDirectory, { recursive: true })
  await mkdir(stagingDirectory, { recursive: true })
  await mkdir(installDirectory, { recursive: true })

  return { tempRoot, tarballDirectory, stagingDirectory, installDirectory }
}

async function prepareSyntheticInstalledRelease(args: {
  root: string
  tempRoot: string
  installDirectory: string
  manifests: readonly WorkspacePackageManifest[]
  npmInstall: NonNullable<RunQualityOptions['npmInstall']>
  signal: AbortSignal
}): Promise<PreparedRelease> {
  const result = await args.npmInstall(args.installDirectory, [], args.signal)
  if (result.exitCode !== 0) {
    return {
      tempRoot: args.tempRoot,
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          'package.json',
          `npm install failed for packed release tarballs: ${sanitizeMessage(result.stderr, 'unknown error')}`
        )
      ]
    }
  }

  await populateSyntheticNodeModules(
    args.root,
    args.installDirectory,
    args.manifests
  )
  return {
    tempRoot: args.tempRoot,
    installDirectory: args.installDirectory,
    manifests: args.manifests,
    diagnostics: []
  }
}

async function installPackedRelease(args: {
  tempRoot: string
  installDirectory: string
  manifests: readonly WorkspacePackageManifest[]
  tarballs: readonly string[]
  signal: AbortSignal
}): Promise<PreparedRelease> {
  const result = await runNpmInstall(
    args.installDirectory,
    args.tarballs,
    args.signal
  )
  if (result.exitCode !== 0) {
    return {
      tempRoot: args.tempRoot,
      diagnostics: [
        releaseDiagnostic(
          'release-install-packages',
          'package.json',
          `npm install failed for packed release tarballs: ${sanitizeMessage(result.stderr, 'unknown error')}`
        )
      ]
    }
  }

  return {
    tempRoot: args.tempRoot,
    installDirectory: args.installDirectory,
    manifests: args.manifests,
    diagnostics: []
  }
}

export async function runInstalledImportSmoke(
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
  const result = await runCommand('node', [scriptPath], {
    cwd: installDirectory,
    signal
  })

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

export async function runInstalledTypeSmoke(
  installDirectory: string,
  manifests: readonly WorkspacePackageManifest[],
  signal: AbortSignal
): Promise<readonly ProjectDiagnostic[]> {
  const specifiers = manifests.flatMap(exportSpecifiers)
  if (specifiers.length === 0) return []

  const source = specifiers.map(typeSmokeImportLine).join('\n')
  const configPath = resolve(installDirectory, 'tsconfig.json')
  const sourcePath = resolve(installDirectory, 'types-smoke.ts')
  await writeFile(configPath, `${JSON.stringify(typeSmokeConfig(), null, 2)}\n`)
  await writeFile(sourcePath, source)
  const result = await runCommand(
    'node',
    [typescriptCli, '--project', configPath],
    { cwd: installDirectory, signal }
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

export async function runInstalledCliSmoke(
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
        { cwd: installDirectory, signal }
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

async function populateSyntheticNodeModules(
  root: string,
  installDirectory: string,
  manifests: readonly WorkspacePackageManifest[]
): Promise<void> {
  const nodeModulesRoot = resolve(installDirectory, 'node_modules')
  await mkdir(nodeModulesRoot, { recursive: true })

  for (const manifest of manifests) {
    const targetDirectory = resolve(nodeModulesRoot, manifest.name)
    await mkdir(resolve(targetDirectory, '..'), { recursive: true })
    await cp(resolve(root, manifest.directory), targetDirectory, {
      recursive: true
    })
  }
}
