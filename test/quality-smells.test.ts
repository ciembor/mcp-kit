import { ESLint } from 'eslint'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('code-smell quality gate', () => {
  it('rejects production files longer than 1500 lines', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: resolve(root, 'eslint.smells.config.js')
    })
    const source = Array.from(
      { length: 1501 },
      (_, index) => `export const line${String(index)} = ${String(index)}`
    ).join('\n')

    const [result] = await eslint.lintText(source, {
      filePath: resolve(root, 'packages/cli/src/oversized.ts')
    })

    expect(result?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'max-lines',
          severity: 2
        })
      ])
    )
  })
})
