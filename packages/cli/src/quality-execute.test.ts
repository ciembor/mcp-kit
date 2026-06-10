import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { executeCommand } from './quality-execute.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('quality command execution', () => {
  it('executes commands and maps empty commands, signals and spawn failures', async () => {
    const root = await makeProject()
    const signal = new AbortController().signal

    await expect(
      executeCommand("node -e 'process.exit(0)'", { cwd: root, signal })
    ).resolves.toBe(0)
    await expect(executeCommand('', { cwd: root, signal })).resolves.toBe(70)
    await expect(
      executeCommand(`node -e "process.kill(process.pid, 'SIGINT')"`, {
        cwd: root,
        signal
      })
    ).resolves.toBe(130)
  })
})

async function makeProject(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-quality-execute-'))
  temporaryDirectories.push(root)
  return root
}
