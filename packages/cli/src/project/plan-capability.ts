import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  CapabilityInput,
  CapabilityRegistrationInput,
  FileOperation,
  FilePlan
} from '../cli-contracts.js'
import { createOrMergeOperation, exists } from '../cli-files.js'
import { capabilityContent } from '../cli-render.js'
import { capitalize } from '../cli-utils.js'
import { manifestUpdateOperation } from './manifest.js'

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
