import { shellQuote } from './quality-config.js'
import type {
  QualityCommand,
  ResolvedQualityConfig,
  RunQualityOptions
} from './contracts.js'

export type Step =
  | { name: string; kind: 'analysis' }
  | { name: string; kind: 'release-check'; check: ReleaseCheckName }
  | { name: string; kind: 'external'; enabled: boolean; command: string }

export type ReleaseCheckName =
  | 'clean-git'
  | 'version'
  | 'changelog'
  | 'package-exports'
  | 'package-files'
  | 'npm-pack'
  | 'install-packages'
  | 'package-usage'
  | 'stdio-smoke'
  | 'http-smoke'

export function fastSteps(
  config: ResolvedQualityConfig,
  options: Pick<RunQualityOptions, 'fix' | 'since'>
): Step[] {
  const suffix =
    options.since === undefined ? '' : ` --changed ${shellQuote(options.since)}`
  return [
    external(
      'format',
      config.formatting,
      options.fix ? config.formatting.fixCommand : config.formatting.command
    ),
    external(
      config.lint.typed ? 'typed-lint' : 'lint',
      config.lint,
      options.fix ? config.lint.fixCommand : config.lint.command
    ),
    external('typecheck', config.typecheck),
    { name: 'architecture', kind: 'analysis' },
    external(
      'unit-tests',
      config.tests.unit,
      `${config.tests.unit.command}${suffix}`
    )
  ]
}

export function fullSteps(
  config: ResolvedQualityConfig,
  options: Pick<RunQualityOptions, 'fix' | 'mode'>
): Step[] {
  const steps = baseFullSteps(config, options.fix)
  if (options.mode === 'mutation') {
    return [...steps, forcedMutationStep(config)]
  }
  if (options.mode === 'release') {
    return [...steps, ...releaseSteps(config)]
  }
  return [...steps, external('mutation', config.mutation)]
}

function external(
  name: string,
  config: QualityCommand,
  commandOverride?: string
): Step {
  return {
    name,
    kind: 'external',
    enabled: config.enabled !== false,
    command: commandOverride ?? config.command
  }
}

function releaseCheck(name: string, check: ReleaseCheckName): Step {
  return { name, kind: 'release-check', check }
}

function baseFullSteps(
  config: ResolvedQualityConfig,
  fix: boolean | undefined
): Step[] {
  return [
    external(
      'format',
      config.formatting,
      fix ? config.formatting.fixCommand : config.formatting.command
    ),
    external(
      config.lint.typed ? 'typed-lint' : 'lint',
      config.lint,
      fix ? config.lint.fixCommand : config.lint.command
    ),
    external('code-smells', config.smells),
    external('typecheck', config.typecheck),
    external('dead-code', config.deadCode),
    external('dependency-cruiser', config.dependencyCruiser),
    { name: 'architecture', kind: 'analysis' },
    external('unit-tests', config.tests.unit),
    external('integration-tests', config.tests.integration),
    external('contract-tests', config.tests.contract),
    external('architecture-tests', config.tests.architecture),
    coverageStep(config),
    external('build', config.build),
    external('package-smoke', config.packageSmoke)
  ]
}

function coverageStep(config: ResolvedQualityConfig): Step {
  return {
    name: 'coverage',
    kind: 'external',
    enabled: config.coverage.enabled,
    command: config.coverage.command
  }
}

function forcedMutationStep(config: ResolvedQualityConfig): Step {
  return {
    name: 'mutation',
    kind: 'external',
    enabled: true,
    command: config.mutation.command
  }
}

function releaseSteps(config: ResolvedQualityConfig): Step[] {
  return [
    releaseCheck('clean-git', 'clean-git'),
    releaseCheck('version', 'version'),
    releaseCheck('changelog', 'changelog'),
    releaseCheck('package-exports', 'package-exports'),
    releaseCheck('package-files', 'package-files'),
    releaseCheck('npm-pack', 'npm-pack'),
    releaseCheck('install-packages', 'install-packages'),
    releaseCheck('package-usage', 'package-usage'),
    releaseCheck('stdio-smoke', 'stdio-smoke'),
    releaseCheck('http-smoke', 'http-smoke'),
    releaseMutationStep(config)
  ]
}

function releaseMutationStep(config: ResolvedQualityConfig): Step {
  return {
    name: 'mutation',
    kind: 'external',
    enabled: config.mutation.enabled === true && config.mutation.runInRelease,
    command: config.mutation.command
  }
}
