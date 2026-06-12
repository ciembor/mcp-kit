import { cp, mkdir, readdir, rename } from 'node:fs/promises'
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
  await restoreBundledTemplateTests(target)

  const projectName = toPackageName(basename(target))
  await replaceTemplateTokens(
    target,
    templateReplacements(projectName, options)
  )

  return target
}

async function restoreBundledTemplateTests(root: string): Promise<void> {
  await restoreBundledTemplateTestsIn(resolve(root, 'test'))
}

async function restoreBundledTemplateTestsIn(directory: string): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }

  for (const entry of entries) {
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await restoreBundledTemplateTestsIn(absolute)
      continue
    }

    const restored = restoredTemplateTestName(entry.name)
    if (restored !== entry.name) {
      await rename(absolute, resolve(directory, restored))
    }
  }
}

function restoredTemplateTestName(name: string): string {
  if (name.endsWith('.test.template.ts')) {
    return name.replace(/\.test\.template\.ts$/u, '.test.ts')
  }
  if (name.endsWith('.test.template.js')) {
    return name.replace(/\.test\.template\.js$/u, '.test.js')
  }
  return name
}
