import { defineConfig, globalIgnores } from 'eslint/config'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

const productionSources = ['packages/*/src/**/*.{js,ts}']

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/.stryker-tmp/**'
  ]),
  {
    ...sonarjs.configs.recommended,
    files: productionSources,
    ignores: ['**/*.test.ts'],
    languageOptions: {
      parser: tseslint.parser
    }
  },
  {
    files: productionSources,
    ignores: ['**/*.test.ts'],
    rules: {
      'max-lines': ['error', { max: 1500 }],
      'sonarjs/cognitive-complexity': ['error', 25],
      // The quality runner intentionally executes commands from the trusted project config.
      'sonarjs/os-command': 'off'
    }
  }
)
