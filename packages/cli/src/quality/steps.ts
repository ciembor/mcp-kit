import { shellQuote } from './quality-config.js'
import type {
  QualityCommand,
  ResolvedQualityConfig,
  RunQualityOptions
} from './contracts.js'

export type Step =
  | { name: string; kind: 'analysis' }
  | { name: string; kind: 'external'; enabled: boolean; command: string }

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
    external('code-smells', config.smells),
    external('typecheck', config.typecheck),
    external('dead-code', config.deadCode),
    external('dependency-cruiser', config.dependencyCruiser),
    { name: 'architecture', kind: 'analysis' },
    external('unit-tests', config.tests.unit),
    external('integration-tests', config.tests.integration),
    external('contract-tests', config.tests.contract),
    external('architecture-tests', config.tests.architecture),
    {
      name: 'coverage',
      kind: 'external',
      enabled: config.coverage.enabled,
      command: config.coverage.command
    },
    external('build', config.build),
    external('package-smoke', config.packageSmoke),
    external('mutation', config.mutation)
  ]
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
