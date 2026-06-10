import { basename, resolve } from 'node:path'

import { getBoolean, getString } from '../cli-args.js'
import { CliError } from '../cli-error.js'
import {
  applyPlan,
  detectProjectContext,
  detectProjectRoot,
  exists,
  safeReaddir
} from '../cli-files.js'
import { planGeneratedProject } from '../cli-plan.js'
import { exitCodes, type CliResult, type ParsedArgs } from '../cli-contracts.js'
import { generatorOptions } from './generator-options.js'

export async function initProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const explicitRoot = getString(parsed, 'root')
  const root = explicitRoot
    ? resolve(cwd, explicitRoot)
    : await detectProjectRoot(cwd, getBoolean(parsed, 'here'))
  const entries = await safeReaddir(root)
  const hasPackageJson = await exists(resolve(root, 'package.json'))
  if (!hasPackageJson && entries.length > 0 && !getBoolean(parsed, 'force')) {
    throw new CliError(
      'Current directory is not empty and has no package.json. Use --force to initialize here.',
      exitCodes.conflict
    )
  }

  const context = await detectProjectContext(root)
  const options = generatorOptions(parsed, {
    language: context.language,
    packageManager: context.packageManager,
    git: false
  })
  const plan = await planGeneratedProject(root, basename(root), options)

  if (!options.dryRun) {
    await applyPlan(plan, { allowOverwrite: false })
  }

  return { command: 'init', root, plan }
}
