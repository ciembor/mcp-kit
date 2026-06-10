import { getBoolean } from '../cli-args.js'
import { CliError } from '../cli-error.js'
import {
  applyPlan,
  detectProjectContext,
  detectProjectRoot
} from '../cli-files.js'
import { planAddCapability } from '../cli-plan.js'
import { exitCodes, type CliResult, type ParsedArgs } from '../cli-contracts.js'
import { toCamelName, toKebabName } from '../cli-utils.js'

export async function addCapability(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const { kind, rawName } = capabilityArguments(parsed.positionals)
  const root = await detectProjectRoot(cwd, false)
  const context = await detectProjectContext(root)
  const plan = await planAddCapability(root, {
    kind,
    feature: toKebabName(rawName),
    symbol: toCamelName(rawName),
    ext: context.language === 'typescript' ? 'ts' : 'js'
  })

  if (!getBoolean(parsed, 'dry-run')) {
    await applyPlan(plan, { allowOverwrite: false })
  }

  return { command: 'add', root, plan }
}

function capabilityArguments(positionals: readonly string[]): {
  kind: 'tool' | 'resource' | 'prompt'
  rawName: string
} {
  const kind = positionals[0]
  const rawName = positionals[1]
  const validKinds = ['tool', 'resource', 'prompt'] as const
  if (
    !validKinds.includes(kind as (typeof validKinds)[number]) ||
    rawName === undefined ||
    rawName.trim() === ''
  ) {
    throw new CliError(
      'Usage: mcp-kit add tool|resource|prompt <name>',
      exitCodes.usage
    )
  }
  return { kind: kind as (typeof validKinds)[number], rawName }
}
