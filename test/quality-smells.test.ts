import { ESLint } from 'eslint'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('code-smell quality gate', () => {
  it('rejects production files longer than 300 lines', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: resolve(root, 'eslint.smells.config.js')
    })
    const source = Array.from(
      { length: 301 },
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

  it('keeps recommended security-sensitive command detection enabled', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: resolve(root, 'eslint.smells.config.js')
    })
    const [result] = await eslint.lintText(
      "import { spawn } from 'node:child_process'\nexport function run(command: string): void {\n  spawn(command, { shell: true })\n}\n",
      {
        filePath: resolve(root, 'packages/cli/src/insecure-command.ts')
      }
    )

    expect(result?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'sonarjs/os-command',
          severity: 2
        })
      ])
    )
  })

  it('enables every built-in Stryker mutation type', async () => {
    const config = JSON.parse(
      await readFile(resolve(root, 'stryker.config.json'), 'utf8')
    ) as {
      mutator?: { excludedMutations?: string[] }
      thresholds?: { break?: number }
    }

    expect(config.mutator?.excludedMutations ?? []).toEqual([])
    expect(config.thresholds?.break).toBe(100)
  })
})
