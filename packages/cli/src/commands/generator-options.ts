import { getBoolean, getEnum } from '../cli-args.js'
import type { GeneratorOptions, ParsedArgs } from '../cli-contracts.js'

export function generatorOptions(
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
