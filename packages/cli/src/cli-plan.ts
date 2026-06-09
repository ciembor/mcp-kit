import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  packageInfo,
  type CapabilityInput,
  type CapabilityRegistrationInput,
  type FileOperation,
  type FilePlan,
  type GeneratorOptions,
  type JsonObject
} from './cli-contracts.js'
import {
  createOrMergeOperation,
  exists,
  findTemplateDirectory,
  readJsonFile,
  readTemplateFiles
} from './cli-files.js'
import {
  agentFiles,
  capabilityContent,
  ciWorkflowContent,
  renderTemplateFile
} from './cli-render.js'
import { capitalize, isJsonObject, sha256, toPackageName } from './cli-utils.js'

export async function planGeneratedProject(
  root: string,
  rawName: string,
  options: GeneratorOptions
): Promise<FilePlan> {
  const template = await findTemplateDirectory()
  const files = await readTemplateFiles(template)
  const projectName = toPackageName(rawName)
  const operations: FileOperation[] = []

  for (const file of files) {
    const rendered = renderTemplateFile(file, {
      projectName,
      options
    })
    if (rendered === undefined) continue
    operations.push(
      await createOrMergeOperation(root, rendered.path, rendered.content)
    )
  }

  operations.push(
    await createOrMergeOperation(root, 'docs/tools.md', '# Tools\n\n- health\n')
  )
  operations.push(...(await projectSupportOperations(root, options)))
  operations.push(await projectManifestOperation(root, operations, options))

  return { root, operations }
}

async function projectSupportOperations(
  root: string,
  options: GeneratorOptions
): Promise<FileOperation[]> {
  const files = [
    ...(options.ci
      ? [
          {
            path: '.github/workflows/ci.yml',
            content: ciWorkflowContent(options.packageManager)
          }
        ]
      : []),
    ...(options.hooks
      ? [
          {
            path: '.githooks/pre-commit',
            content: '#!/usr/bin/env sh\nset -eu\nnpm run quality:fast\n'
          }
        ]
      : []),
    ...(options.hooks && options.quality === 'strict'
      ? [
          {
            path: '.githooks/pre-push',
            content: '#!/usr/bin/env sh\nset -eu\nnpm run quality:full\n'
          }
        ]
      : []),
    ...agentFiles(options.agent)
  ]
  return Promise.all(
    files.map((file) => createOrMergeOperation(root, file.path, file.content))
  )
}

async function projectManifestOperation(
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

export async function planAddCapability(
  root: string,
  input: CapabilityInput
): Promise<FilePlan> {
  const suffix = input.kind
  const exported = `${input.symbol}${capitalize(input.kind)}`
  const operations: FileOperation[] = []
  const path = `src/features/${input.feature}/mcp/${input.feature}.${suffix}.${input.ext}`
  operations.push(
    await createOrMergeOperation(
      root,
      path,
      capabilityContent(input.kind, exported)
    )
  )
  operations.push(await featureIndexUpdateOperation(root, input, exported))
  operations.push(
    await createOrMergeOperation(
      root,
      `test/contracts/${input.feature}.${input.kind}.contract.test.ts`,
      `import { describe, expect, it } from 'vitest'\n\nimport { ${exported} } from '../../src/features/${input.feature}/mcp/${input.feature}.${suffix}.js'\n\ndescribe('${input.feature} ${input.kind}', () => {\n  it('has a stable name', () => {\n    expect(${exported}.name).toBe('${input.feature}')\n  })\n})\n`
    )
  )
  operations.push(await registryUpdateOperation(root, input, exported))
  operations.push(await docsUpdateOperation(root, input))
  operations.push(await manifestUpdateOperation(root, operations))
  return { root, operations }
}

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

async function registryUpdateOperation(
  root: string,
  input: CapabilityRegistrationInput,
  exported: string
): Promise<FileOperation> {
  const path = 'src/mcp/registry.ts'
  const absolute = resolve(root, path)
  const importPath = `../features/${input.feature}/mcp/${input.feature}.${input.kind}.js`
  const registryNames = {
    tool: 'tools',
    resource: 'resources',
    prompt: 'prompts'
  } as const
  const registryName = registryNames[input.kind]
  const current = (await exists(absolute))
    ? await readFile(absolute, 'utf8')
    : "import { defineRegistry } from '@mcp-kit/core'\n\nexport const tools = defineRegistry([])\nexport const resources = defineRegistry([])\nexport const prompts = defineRegistry([])\n"

  if (current.includes(importPath) || current.includes(exported)) {
    return { kind: 'merge-package', path, content: current }
  }

  const lines = current.split('\n')
  const importLine = `import { ${exported} } from '${importPath}'`
  const lastImportIndex = lines.reduce(
    (last, line, index) => (line.startsWith('import ') ? index : last),
    -1
  )
  lines.splice(lastImportIndex + 1, 0, importLine)
  let updated = lines.join('\n')
  const registryPattern = new RegExp(
    `export const ${registryName} = defineRegistry\\(\\[([^\\]]*)\\]\\)`
  )
  updated = updated.replace(registryPattern, (_match, items: string) => {
    const existing = items
      .split(',')
      .map((item: string) => item.trim())
      .filter(Boolean)
    return `export const ${registryName} = defineRegistry([${[
      ...existing,
      exported
    ].join(', ')}])`
  })
  return { kind: 'overwrite', path, content: updated }
}

async function featureIndexUpdateOperation(
  root: string,
  input: CapabilityRegistrationInput,
  exported: string
): Promise<FileOperation> {
  const path = `src/features/${input.feature}/index.${input.ext}`
  const absolute = resolve(root, path)
  const exportLine = `export { ${exported} } from './mcp/${input.feature}.${input.kind}.js'`
  const current = (await exists(absolute))
    ? await readFile(absolute, 'utf8')
    : ''
  const separator = current.trim() === '' ? '' : '\n'
  const content = current.includes(exportLine)
    ? current
    : `${current.trimEnd()}${separator}${exportLine}\n`
  return {
    kind: (await exists(absolute)) ? 'overwrite' : 'create',
    path,
    content
  }
}

async function docsUpdateOperation(
  root: string,
  input: { kind: 'tool' | 'resource' | 'prompt'; feature: string }
): Promise<FileOperation> {
  const path = `docs/${input.kind}s.md`
  const absolute = resolve(root, path)
  const entry = `- ${input.feature}`
  const current = (await exists(absolute))
    ? await readFile(absolute, 'utf8')
    : `# ${capitalize(input.kind)}s\n\n`
  const content = current.includes(entry)
    ? current
    : `${current.trimEnd()}\n${entry}\n`
  return {
    kind: (await exists(absolute)) ? 'overwrite' : 'create',
    path,
    content
  }
}

async function manifestUpdateOperation(
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
