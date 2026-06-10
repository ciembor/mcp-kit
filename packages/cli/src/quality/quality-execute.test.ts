import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { executeCommand } from './quality-execute.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      const { rm } = await import('node:fs/promises')
      await rm(directory, { recursive: true, force: true })
    })
  )
})

describe('quality command execution', () => {
  it('runs commands, parses simple quotes and handles empty commands', async () => {
    const root = await createTempDirectory('mcp-kit-quality-execute-')
    const output = resolve(root, 'output.txt')
    const signal = new AbortController().signal

    const success = await executeCommand(
      `node -e "require('node:fs').writeFileSync('${output}', 'ok')"`,
      {
        cwd: root,
        signal
      }
    )
    const quoted = await executeCommand(`node -e "process.exit(0)"`, {
      cwd: root,
      signal
    })
    const empty = await executeCommand('', { cwd: root, signal })

    expect(success).toBe(0)
    expect(quoted).toBe(0)
    expect(empty).toBe(70)
    await expect(writeFile(output, 'still there')).resolves.toBeUndefined()
  })

  it('returns failure codes for spawned process failures and aborts', async () => {
    const root = await createTempDirectory('mcp-kit-quality-execute-')

    const failure = await executeCommand(`node -e "process.exit(5)"`, {
      cwd: root,
      signal: new AbortController().signal
    })

    const controller = new AbortController()
    const running = executeCommand(
      `node -e "setTimeout(() => process.exit(0), 1000)"`,
      {
        cwd: root,
        signal: controller.signal
      }
    )
    controller.abort()

    expect(failure).toBe(5)
    await expect(running).resolves.toBe(143)
  })
})

async function createTempDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix))
  temporaryDirectories.push(root)
  return root
}
