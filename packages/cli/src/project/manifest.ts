import { resolve } from 'node:path'

import {
  packageInfo,
  type FileOperation,
  type GeneratorOptions,
  type JsonObject
} from '../cli-contracts.js'
import { exists, readJsonFile } from '../cli-files.js'
import { isJsonObject, sha256 } from '../cli-utils.js'

export function buildManifest(
  operations: readonly FileOperation[],
  options: GeneratorOptions
): JsonObject {
  return {
    generator: packageInfo.version,
    template: 'default',
    templateVersion: '0.0.0',
    options: {
      transport: options.transport,
      quality: options.quality,
      language: options.language,
      packageManager: options.packageManager,
      hooks: options.hooks,
      ci: options.ci,
      agent: options.agent
    },
    files: operations
      .filter((operation) => operation.content !== undefined)
      .map((operation) => ({
        path: operation.path,
        kind: operation.kind,
        checksum: sha256(operation.content!)
      }))
  }
}

export function mergeManifestFiles(files: readonly JsonObject[]): JsonObject[] {
  const byPath = new Map<string, JsonObject>()
  for (const file of files) {
    const path = file['path']
    if (typeof path === 'string') byPath.set(path, file)
  }
  return [...byPath.values()].sort((left, right) => {
    const leftPath = left['path'] as string
    const rightPath = right['path'] as string
    if (leftPath < rightPath) return -1
    return 1
  })
}

export async function projectManifestOperation(
  root: string,
  operations: readonly FileOperation[],
  options: GeneratorOptions
): Promise<FileOperation> {
  return {
    kind: (await exists(resolve(root, '.mcp-kit/manifest.json')))
      ? 'overwrite'
      : 'create',
    path: '.mcp-kit/manifest.json',
    content: `${JSON.stringify(buildManifest(operations, options), null, 2)}\n`
  }
}

export async function manifestUpdateOperation(
  root: string,
  operations: readonly FileOperation[]
): Promise<FileOperation> {
  const existingManifest = await readJsonFile(
    resolve(root, '.mcp-kit/manifest.json')
  )
  const files =
    isJsonObject(existingManifest) && Array.isArray(existingManifest['files'])
      ? existingManifest['files'].filter(isJsonObject)
      : []
  const additions = operations
    .filter((operation) => operation.content !== undefined)
    .map((operation) => ({
      path: operation.path,
      checksum: sha256(operation.content!)
    }))
  return {
    kind: (await exists(resolve(root, '.mcp-kit/manifest.json')))
      ? 'overwrite'
      : 'create',
    path: '.mcp-kit/manifest.json',
    content: `${JSON.stringify(
      {
        generator: packageInfo.version,
        updatedAt: new Date(0).toISOString(),
        files: mergeManifestFiles([...files, ...additions])
      },
      null,
      2
    )}\n`
  }
}
