import type {
  FileOperation,
  FilePlan,
  GeneratorOptions
} from '../cli-contracts.js'
import {
  createOrMergeOperation,
  findTemplateDirectory,
  readTemplateFiles
} from '../cli-files.js'
import {
  agentFiles,
  ciWorkflowContent,
  renderTemplateFile
} from '../cli-render.js'
import { toPackageName } from '../cli-utils.js'
import { projectManifestOperation } from './manifest.js'

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
