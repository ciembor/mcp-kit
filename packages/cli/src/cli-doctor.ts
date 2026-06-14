import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { DoctorDiagnostic } from './cli-contracts.js'
import { asJsonObject, isJsonObject, sha256 } from './cli-utils.js'
import { exists, readJsonFile } from './cli-files.js'

export async function collectDoctorDiagnostics(
  root: string,
  nodeVersion: string,
  packageManager: string
): Promise<DoctorDiagnostic[]> {
  return [
    nodeVersionDiagnostic(nodeVersion),
    {
      level: 'ok',
      code: 'package-manager',
      message: `Detected ${packageManager}`
    },
    await fileDiagnostic(root, 'package.json', 'package-json', 'package.json'),
    await fileDiagnostic(root, 'tsconfig.json', 'tsconfig', 'tsconfig.json'),
    await fileDiagnostic(
      root,
      '.mcp-kit/manifest.json',
      'manifest',
      'mcp-kit manifest'
    ),
    await scriptsDiagnostic(root),
    await registryDiagnostic(root),
    await manifestDiagnostic(root),
    await stdoutDiagnostic(root),
    await httpDiagnostic(root),
    await boundedContextDiagnostic(root)
  ]
}

export function isSupportedNodeVersion(version: string): boolean {
  const [majorRaw, minorRaw] = version.split('.')
  const major = Number(majorRaw)
  const minor = Number(minorRaw)
  return major === 24 || (major === 22 && minor >= 13)
}

export function nodeVersionDiagnostic(version: string): DoctorDiagnostic {
  return {
    level: isSupportedNodeVersion(version) ? 'ok' : 'error',
    code: 'node-version',
    message: `Node.js ${version}`
  }
}

async function fileDiagnostic(
  root: string,
  path: string,
  code: string,
  label: string
): Promise<DoctorDiagnostic> {
  return {
    level: (await exists(resolve(root, path))) ? 'ok' : 'error',
    code,
    message: `${label} ${(await exists(resolve(root, path))) ? 'exists' : 'is missing'}`
  }
}

async function scriptsDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const packageJson = await readJsonFile(resolve(root, 'package.json'))
  if (!isJsonObject(packageJson)) {
    return {
      level: 'error',
      code: 'scripts',
      message: 'package.json is missing or invalid'
    }
  }
  const scripts = asJsonObject(packageJson['scripts'])
  return {
    level: scripts['start'] === undefined ? 'warning' : 'ok',
    code: 'scripts',
    message:
      scripts['start'] === undefined
        ? 'start script is missing'
        : 'start script exists'
  }
}

async function registryDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const path = resolve(root, 'src/mcp/registry.ts')
  if (!(await exists(path))) {
    return {
      level: 'error',
      code: 'registry',
      message: 'src/mcp/registry.ts is missing'
    }
  }
  const content = await readFile(path, 'utf8')
  return {
    level: content.includes('defineRegistry') ? 'ok' : 'error',
    code: 'registry',
    message: content.includes('defineRegistry')
      ? 'registry uses defineRegistry'
      : 'registry does not use defineRegistry'
  }
}

async function manifestDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const manifest = await readJsonFile(resolve(root, '.mcp-kit/manifest.json'))
  if (!isJsonObject(manifest) || !Array.isArray(manifest['files'])) {
    return {
      level: 'warning',
      code: 'manifest-integrity',
      message: 'manifest is missing or has no files list'
    }
  }
  const entries = await Promise.all(
    manifest['files'].map((file) => inspectManifestEntry(root, file))
  )
  const missing = entries.filter((status) => status === 'missing')
  const modified = entries.filter((status) => status === 'modified')
  if (missing.length > 0 || modified.length > 0) {
    return {
      level: 'warning',
      code: 'manifest-integrity',
      message: `Manifest drift: ${missing.length} missing, ${modified.length} modified`
    }
  }
  return {
    level: 'ok',
    code: 'manifest-integrity',
    message: 'manifest entries are present and unchanged'
  }
}

async function inspectManifestEntry(
  root: string,
  value: unknown
): Promise<'ok' | 'missing' | 'modified' | 'ignored'> {
  if (!isJsonObject(value) || typeof value['path'] !== 'string') {
    return 'ignored'
  }
  const absolute = resolve(root, value['path'])
  if (!(await exists(absolute))) return 'missing'
  if (typeof value['checksum'] !== 'string') return 'ok'
  const checksum = sha256(await readFile(absolute, 'utf8'))
  return checksum === value['checksum'] ? 'ok' : 'modified'
}

async function stdoutDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const stdioPath = resolve(root, 'src/server/transports/stdio.ts')
  if (!(await exists(stdioPath))) {
    return {
      level: 'warning',
      code: 'stdio-stdout',
      message: 'stdio transport file is missing'
    }
  }
  const content = await readFile(stdioPath, 'utf8')
  const unsafe = /console\.log|process\.stdout\.write/.test(content)
  return {
    level: unsafe ? 'error' : 'ok',
    code: 'stdio-stdout',
    message: unsafe
      ? 'stdio transport writes application output to stdout'
      : 'stdio transport does not write application output to stdout'
  }
}

async function httpDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const configPath = resolve(root, 'mcp-kit.config.ts')
  const content = (await exists(configPath))
    ? await readFile(configPath, 'utf8')
    : ''
  const productionHttpConfigured =
    content.includes("transport: 'http'") &&
    (content.includes("mode: 'production'") ||
      process.env['NODE_ENV'] === 'production')
  const inMemoryStoresDetected =
    productionHttpConfigured &&
    (content.includes('inMemory') ||
      (await projectContainsInMemoryStoreAdapter(root)))
  return {
    level: inMemoryStoresDetected ? 'error' : 'ok',
    code: 'http-security',
    message: inMemoryStoresDetected
      ? 'production HTTP uses a development/test in-memory store'
      : 'no unsafe production HTTP configuration detected'
  }
}

const inMemoryStoreFactories = [
  'createInMemorySessionStore',
  'createInMemoryEventStore',
  'createInMemoryJobStore',
  'createInMemoryJobQueue',
  'createInMemoryRateLimitStore',
  'createInMemoryConcurrencyStore',
  'createInMemoryAuditStore',
  'createInMemoryIdempotencyStore'
]

async function projectContainsInMemoryStoreAdapter(
  root: string
): Promise<boolean> {
  for (const path of await projectTextFiles(root)) {
    const content = await readFile(path, 'utf8')
    if (
      inMemoryStoreFactories.some((factory) => content.includes(`${factory}(`))
    ) {
      return true
    }
  }
  return false
}

async function projectTextFiles(root: string): Promise<string[]> {
  const entries: string[] = []
  await walkProject(root, entries)
  return entries
}

async function walkProject(current: string, entries: string[]): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const absolute = resolve(current, entry.name)
    if (entry.isDirectory()) {
      await walkProject(absolute, entries)
      continue
    }
    if (!/\.(cjs|cts|js|json|jsx|mjs|mts|ts|tsx)$/.test(entry.name)) continue
    entries.push(absolute)
  }
}

async function boundedContextDiagnostic(
  root: string
): Promise<DoctorDiagnostic> {
  const configPath = resolve(root, 'mcp-kit.config.ts')
  const content = (await exists(configPath))
    ? await readFile(configPath, 'utf8')
    : ''
  const broad =
    content.includes("boundedContext: '*'") ||
    content.includes("boundedContext: 'all'")
  return {
    level: broad ? 'warning' : 'ok',
    code: 'bounded-context',
    message: broad
      ? 'bounded context is broader than recommended'
      : 'bounded context configuration is present or not broad'
  }
}
