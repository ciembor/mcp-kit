import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  exitCodes,
  type PackageManager,
  type ProjectContext,
  type ProjectLanguage
} from '../cli-contracts.js'
import { CliError } from '../cli-error.js'
import { isJsonObject, isNodeErrorCode } from '../cli-utils.js'
import { exists, readJsonFile } from './helpers.js'

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
