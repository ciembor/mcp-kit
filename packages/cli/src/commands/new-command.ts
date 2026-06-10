import { basename, resolve } from 'node:path'

import { CliError } from '../cli-error.js'
import {
  applyPlan,
  assertSafeNewTarget,
  detectPackageManager
} from '../cli-files.js'
import { planGeneratedProject } from '../cli-plan.js'
import { exitCodes, type CliResult, type ParsedArgs } from '../cli-contracts.js'
import { generatorOptions } from './generator-options.js'

export async function createNewProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const name = parsed.positionals[0]
  if (name === undefined || name.trim() === '') {
    throw new CliError('Usage: mcp-kit new <name>', exitCodes.usage)
  }

  const options = generatorOptions(parsed, {
    language: 'typescript',
    packageManager: detectPackageManager(cwd)
  })
  const root = resolve(cwd, name)
  await assertSafeNewTarget(root, options.force)
  const plan = await planGeneratedProject(root, basename(root), options)

  if (!options.dryRun) {
    await applyPlan(plan, { allowOverwrite: options.force })
  }

  return { command: 'new', root, plan }
}
