import { cp, mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  findTemplateDirectory,
  resolveDefaultTemplateCandidates
} from './template-directory.js'
import {
  assertEmptyOrMissing,
  assertTargetWithinRoot
} from './target-directory.js'
import {
  replaceTemplateTokens,
  templateReplacements
} from './template-tokens.js'
import { toPackageName } from '../shared/package-name.js'

export type CreateMcpKitOptions = {
  cwd?: string
  corePackage?: string
  nodePackage?: string
  cliPackage?: string
  testingPackage?: string
  templateDirectory?: string
}

export async function createMcpKitProject(
  projectPath: string,
  options: CreateMcpKitOptions = {}
): Promise<string> {
  if (projectPath.trim() === '') {
    throw new Error('Project directory is required')
  }

  const root = resolve(options.cwd ?? process.cwd())
  const target = resolve(root, projectPath)
  await assertTargetWithinRoot(root, target)
  await assertEmptyOrMissing(target)
  await mkdir(target, { recursive: true })

  const template =
    options.templateDirectory ??
    (await findTemplateDirectory(
      resolveDefaultTemplateCandidates(import.meta.url)
    ))
  await cp(template, target, { recursive: true })

  const projectName = toPackageName(basename(target))
  await replaceTemplateTokens(
    target,
    templateReplacements(projectName, options)
  )

  return target
}
