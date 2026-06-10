import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  exitCodes,
  type FileOperation,
  type FilePlan
} from '../cli-contracts.js'
import { CliError } from '../cli-error.js'
import {
  conflictContent,
  jsonMergeContent,
  packageJsonMergeContent
} from '../cli-merge.js'
import { exists } from './helpers.js'

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
  const state = { backups, written }

  try {
    await mkdir(plan.root, { recursive: true })
    for (const operation of plan.operations) {
      await applyOperation(plan.root, operation, options, state)
    }
  } catch (error) {
    await rollbackPlan(written, backups)
    throw error
  }

  await Promise.all(
    backups.map((backup) => rm(backup.backupPath, { force: true }))
  )
}

type Backup = { path: string; backupPath: string }
type PlanState = { backups: Backup[]; written: string[] }

async function applyOperation(
  root: string,
  operation: FileOperation,
  options: { allowOverwrite: boolean },
  state: PlanState
): Promise<void> {
  if (operation.content === undefined) return
  const content = operation.content
  const absolute = resolve(root, operation.path)
  await mkdir(dirname(absolute), { recursive: true })
  if (await exists(absolute)) {
    if (
      await unchangedOrProtected(absolute, { ...operation, content }, options)
    ) {
      return
    }
    const backupPath = `${absolute}.mcp-kit-backup`
    await rm(backupPath, { force: true })
    await rename(absolute, backupPath)
    state.backups.push({ path: absolute, backupPath })
  }
  await writeFile(absolute, content)
  state.written.push(absolute)
}

async function unchangedOrProtected(
  absolute: string,
  operation: FileOperation & { content: string },
  options: { allowOverwrite: boolean }
): Promise<boolean> {
  const protectedFile =
    operation.kind === 'create' ||
    (operation.kind === 'overwrite' &&
      !options.allowOverwrite &&
      operation.path.endsWith('.mcp-kit.conflict'))
  if (!protectedFile) return false
  if ((await readFile(absolute, 'utf8')) === operation.content) return true
  throw new CliError(
    `Refusing to overwrite unmanaged file: ${operation.path}`,
    exitCodes.conflict
  )
}

async function rollbackPlan(
  written: readonly string[],
  backups: Backup[]
): Promise<void> {
  await Promise.all(written.map((path) => rm(path, { force: true })))
  for (const backup of backups.reverse()) {
    /* v8 ignore next 2 -- best-effort cleanup when backup restore itself fails. */
    await rename(backup.backupPath, backup.path).catch(async () => {
      await rm(backup.backupPath, { force: true })
    })
  }
}
