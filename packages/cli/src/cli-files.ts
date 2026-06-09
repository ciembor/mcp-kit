import { existsSync } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  exitCodes,
  type FileOperation,
  type FilePlan,
  type JsonValue,
  type PackageManager,
  type ProjectContext,
  type ProjectLanguage
} from './cli-contracts.js'
import { CliError } from './cli-error.js'
import {
  conflictContent,
  jsonMergeContent,
  packageJsonMergeContent
} from './cli-merge.js'
import { isJsonObject, isNodeErrorCode } from './cli-utils.js'

export async function createOrMergeOperation(
  root: string,
  path: string,
  content: string
): Promise<FileOperation> {
  const absolute = resolve(root, path)
  if (!(await exists(absolute))) {
    return { kind: 'create', path, content }
  }
  const existing = await readFile(absolute, 'utf8')
  if (existing === content) {
    return { kind: 'create', path, content }
  }
  if (path === 'package.json') {
    return {
      kind: 'merge-package',
      path,
      content: packageJsonMergeContent(existing, content)
    }
  }
  if (path.endsWith('.json')) {
    return {
      kind: 'merge-json',
      path,
      content: jsonMergeContent(existing, content)
    }
  }
  if (path.endsWith('.yml') || path.endsWith('.yaml')) {
    return {
      kind: 'merge-yaml',
      path,
      content: conflictContent(existing, content)
    }
  }
  return {
    kind: 'conflict',
    path: `${path}.mcp-kit.conflict`,
    content: conflictContent(existing, content)
  }
}

export async function applyPlan(
  plan: FilePlan,
  options: { allowOverwrite: boolean }
): Promise<void> {
  const backups: { path: string; backupPath: string }[] = []
  const written: string[] = []

  try {
    await mkdir(plan.root, { recursive: true })
    for (const operation of plan.operations) {
      if (operation.content === undefined) continue
      const absolute = resolve(plan.root, operation.path)
      await mkdir(dirname(absolute), { recursive: true })

      if (await exists(absolute)) {
        if (
          operation.kind === 'create' ||
          (operation.kind === 'overwrite' &&
            !options.allowOverwrite &&
            operation.path.endsWith('.mcp-kit.conflict'))
        ) {
          const existing = await readFile(absolute, 'utf8')
          if (existing === operation.content) continue
          throw new CliError(
            `Refusing to overwrite unmanaged file: ${operation.path}`,
            exitCodes.conflict
          )
        }
        const backupPath = `${absolute}.mcp-kit-backup`
        await rm(backupPath, { force: true })
        await rename(absolute, backupPath)
        backups.push({ path: absolute, backupPath })
      }

      await writeFile(absolute, operation.content)
      written.push(absolute)
    }
  } catch (error) {
    await Promise.all(written.map((path) => rm(path, { force: true })))
    for (const backup of backups.reverse()) {
      /* v8 ignore next 2 -- best-effort cleanup when backup restore itself fails. */
      await rename(backup.backupPath, backup.path).catch(async () => {
        await rm(backup.backupPath, { force: true })
      })
    }
    throw error
  }

  await Promise.all(
    backups.map((backup) => rm(backup.backupPath, { force: true }))
  )
}

export async function assertSafeNewTarget(
  root: string,
  force: boolean
): Promise<void> {
  try {
    const targetStat = await stat(root)
    if (!targetStat.isDirectory()) {
      throw new CliError(
        `Target exists and is not a directory: ${root}`,
        exitCodes.conflict
      )
    }
    if (!force && (await readdir(root)).length > 0) {
      throw new CliError(
        `Target directory is not empty: ${root}`,
        exitCodes.conflict
      )
    }
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return
    throw error
  }
}

export async function detectProjectRoot(
  cwd: string,
  here: boolean
): Promise<string> {
  if (here) return cwd
  const gitRoot = await findUp(cwd, '.git')
  if (gitRoot !== undefined) return gitRoot
  const packageRoot = await findUp(cwd, 'package.json')
  return packageRoot ?? cwd
}

export async function detectProjectContext(
  root: string
): Promise<ProjectContext> {
  const gitRoot = await findUp(root, '.git')
  const context: ProjectContext = {
    root,
    packageManager: detectPackageManager(root),
    language: await detectLanguage(root)
  }
  if (gitRoot !== undefined) context.gitRoot = gitRoot
  return context
}

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(resolve(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(resolve(root, 'package-lock.json'))) return 'npm'
  if (existsSync(resolve(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(resolve(root, 'bun.lockb'))) return 'bun'
  return 'pnpm'
}

export async function detectLanguage(root: string): Promise<ProjectLanguage> {
  if (await exists(resolve(root, 'tsconfig.json'))) return 'typescript'
  const packageJson = await readJsonFile(resolve(root, 'package.json'))
  if (
    isJsonObject(packageJson) &&
    isJsonObject(packageJson['devDependencies']) &&
    packageJson['devDependencies']['typescript'] !== undefined
  ) {
    return 'typescript'
  }
  return 'javascript'
}

export async function findTemplateDirectory(
  candidates: readonly string[] = [
    fileURLToPath(new URL('./template', import.meta.url)),
    fileURLToPath(new URL('../../../templates/default', import.meta.url))
  ]
): Promise<string> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) continue
      throw error
    }
  }
  throw new CliError(
    'Bundled project template was not found',
    exitCodes.internal
  )
}

export async function readTemplateFiles(
  directory: string,
  prefix = ''
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readTemplateFiles(absolute, path)))
    } else {
      files.push({ path, content: await readFile(absolute, 'utf8') })
    }
  }
  return files
}

export async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

export async function readJsonFile(
  path: string
): Promise<JsonValue | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as JsonValue
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined
    return undefined
  }
}

async function findUp(
  start: string,
  marker: string
): Promise<string | undefined> {
  let current = resolve(start)
  while (true) {
    if (await exists(resolve(current, marker))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
