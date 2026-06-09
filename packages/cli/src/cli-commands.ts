import { basename, resolve } from 'node:path'

import { getBoolean, getEnum, getString } from './cli-args.js'
import { CliError } from './cli-error.js'
import {
  applyPlan,
  assertSafeNewTarget,
  detectPackageManager,
  detectProjectContext,
  detectProjectRoot,
  safeReaddir,
  exists
} from './cli-files.js'
import { collectDoctorDiagnostics } from './cli-doctor.js'
import { planAddCapability, planGeneratedProject } from './cli-plan.js'
import { runQuality, type QualityMode } from './quality.js'
import { toCamelName, toKebabName } from './cli-utils.js'
import {
  exitCodes,
  type CliResult,
  type GeneratorOptions,
  type ParsedArgs
} from './cli-contracts.js'

export async function qualityProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const fast = getBoolean(parsed, 'fast')
  const full = getBoolean(parsed, 'full')
  if (fast === full) {
    throw new CliError('Usage: mcp-kit quality --fast|--full', exitCodes.usage)
  }
  const mode: QualityMode = fast ? 'fast' : 'full'
  const root = await detectProjectRoot(cwd, false)
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const since = getString(parsed, 'since')
    const quality = await runQuality({
      root,
      mode,
      fix: getBoolean(parsed, 'fix'),
      signal: controller.signal,
      ...(since === undefined ? {} : { since })
    })
    return {
      command: 'quality',
      root,
      quality,
      exitCode:
        quality.status === 'passed' ? exitCodes.ok : exitCodes.validation
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

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

export async function doctorProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const root = await detectProjectRoot(cwd, getBoolean(parsed, 'here'))
  const context = await detectProjectContext(root)
  const diagnostics = await collectDoctorDiagnostics(
    root,
    process.versions.node,
    context.packageManager
  )

  return { command: 'doctor', root, diagnostics }
}

function generatorOptions(
  parsed: ParsedArgs,
  detected: Pick<GeneratorOptions, 'language' | 'packageManager'> &
    Partial<Pick<GeneratorOptions, 'git'>>
): GeneratorOptions {
  const transport = getEnum(parsed, 'transport', ['stdio', 'http', 'both'])
  const quality = getEnum(parsed, 'quality', ['off', 'standard', 'strict'])
  const language = getEnum(parsed, 'language', ['typescript', 'javascript'])
  const packageManager = getEnum(parsed, 'package-manager', [
    'pnpm',
    'npm',
    'yarn',
    'bun'
  ])
  const agent = getEnum(parsed, 'agent', [
    'none',
    'generic',
    'claude',
    'cursor',
    'codex'
  ])
  return {
    transport: transport ?? 'stdio',
    quality: quality ?? 'standard',
    language: language ?? detected.language,
    packageManager: packageManager ?? detected.packageManager,
    git: detected.git ?? !getBoolean(parsed, 'no-git'),
    hooks: !getBoolean(parsed, 'no-hooks'),
    ci: !getBoolean(parsed, 'no-ci'),
    install: !getBoolean(parsed, 'no-install'),
    agent: agent ?? 'none',
    force: getBoolean(parsed, 'force'),
    dryRun: getBoolean(parsed, 'dry-run')
  }
}
