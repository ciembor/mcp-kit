import { defineQualityConfig } from '@mcp-kit/cli'

export default defineQualityConfig({
  preset: 'standard',
  project: {
    root: '.',
    source: ['packages/*/src/**/*.ts'],
    tests: ['packages/*/src/**/*.test.ts', 'test/**/*.test.ts']
  },
  formatting: {
    command: 'prettier --check .',
    fixCommand: 'prettier --write .'
  },
  lint: {
    command: 'eslint .',
    fixCommand: 'eslint . --fix',
    typed: true
  },
  smells: {
    command: 'knip'
  },
  typecheck: {
    command: 'corepack pnpm typecheck'
  },
  deadCode: {
    command: 'knip'
  },
  dependencyCruiser: {
    command:
      'dependency-cruiser packages test --config dependency-cruiser.config.cjs'
  },
  tests: {
    unit: { command: "vitest run --exclude 'test/e2e/**'" },
    integration: {
      enabled: true,
      command: 'vitest run test/e2e'
    },
    contract: { enabled: true, command: 'vitest run test/smoke' }
  },
  coverage: {
    command:
      "vitest run --coverage --exclude 'test/e2e/**' --coverage.thresholds.lines=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90 --coverage.thresholds.branches=85 --coverage.include='packages/*/src/**/*.ts' --coverage.exclude='packages/*/src/bin.ts' --coverage.exclude='packages/*/src/**/*.test.ts'",
    include: ['packages/*/src/**/*.ts'],
    exclude: [
      {
        pattern: 'packages/*/src/bin.ts',
        reason: 'Executable dispatch is covered by package smoke tests.'
      },
      {
        pattern: 'packages/*/src/**/*.test.ts',
        reason: 'Test files are not production code.'
      }
    ]
  },
  build: {
    command: 'corepack pnpm build'
  },
  packageSmoke: {
    enabled: true,
    command: 'vitest run test/smoke'
  }
})
