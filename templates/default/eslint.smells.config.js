import { defineConfig, globalIgnores } from 'eslint/config'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

const productionSources = ['src/**/*.{js,ts}']

export default defineConfig(
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),
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
      complexity: ['error', 8],
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true }
      ],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true }
      ],
      'max-params': ['error', 4],
      'sonarjs/cognitive-complexity': ['error', 12]
    }
  }
)
