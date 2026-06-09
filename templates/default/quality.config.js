import { defineQualityConfig } from '@mcp-kit/cli'

export default defineQualityConfig({
  preset: 'standard',
  project: {
    root: '.',
    source: ['src/**/*.ts'],
    tests: ['test/**/*.test.ts']
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
    command: 'eslint --config eslint.smells.config.js'
  },
  typecheck: {
    command: 'npm run typecheck --if-present'
  },
  deadCode: {
    command: 'knip'
  },
  dependencyCruiser: {
    command: 'dependency-cruiser src --config dependency-cruiser.config.cjs'
  },
  tests: {
    unit: { command: 'vitest run' }
  },
  coverage: {
    include: ['src/**/*.ts'],
    exclude: [
      {
        pattern: 'src/**/index.ts',
        reason:
          'Public export-only boundaries are verified by architecture tests.'
      },
      {
        pattern: 'src/main.ts',
        reason:
          'The process entrypoint is covered by the stdio integration smoke test.'
      }
    ]
  },
  build: {
    command: 'npm run build --if-present'
  }
})
