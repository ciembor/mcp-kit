import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connectStdioTestClient } from '../../packages/testing/src/index.js'
import { createMcpKitProject } from '../../packages/create-mcp-kit/src/index.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../..')
const node = '/opt/homebrew/bin/node'
const environment = {
  ...process.env,
  PATH: `/opt/homebrew/bin:${process.env['PATH'] ?? ''}`
}

let temporaryDirectory: string
let serverDirectory: string

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'mcp-kit-e2e-'))

  await run('corepack', ['pnpm', 'build'], repositoryRoot)
  await run(
    'corepack',
    [
      'pnpm',
      '--filter',
      '@mcp-kit/core',
      'pack',
      '--pack-destination',
      temporaryDirectory
    ],
    repositoryRoot
  )
  await run(
    'corepack',
    [
      'pnpm',
      '--filter',
      '@mcp-kit/testing',
      'pack',
      '--pack-destination',
      temporaryDirectory
    ],
    repositoryRoot
  )
  await run(
    'corepack',
    [
      'pnpm',
      '--filter',
      '@mcp-kit/cli',
      'pack',
      '--pack-destination',
      temporaryDirectory
    ],
    repositoryRoot
  )
  await run(
    'corepack',
    [
      'pnpm',
      '--filter',
      '@mcp-kit/node',
      'pack',
      '--pack-destination',
      temporaryDirectory
    ],
    repositoryRoot
  )

  const corePackage = `file:${resolve(
    temporaryDirectory,
    'mcp-kit-core-0.0.0.tgz'
  )}`
  const nodePackage = `file:${resolve(
    temporaryDirectory,
    'mcp-kit-node-0.0.0.tgz'
  )}`
  const testingPackage = `file:${resolve(
    temporaryDirectory,
    'mcp-kit-testing-0.0.0.tgz'
  )}`
  const cliPackage = `file:${resolve(
    temporaryDirectory,
    'mcp-kit-cli-0.0.0.tgz'
  )}`
  serverDirectory = await createMcpKitProject('generated-server', {
    cwd: temporaryDirectory,
    corePackage,
    nodePackage,
    testingPackage,
    cliPackage
  })
  await writeFile(
    resolve(serverDirectory, 'pnpm-workspace.yaml'),
    `overrides:\n  '@mcp-kit/core': ${corePackage}\n`
  )

  await run('corepack', ['pnpm', 'install'], serverDirectory)
  await run('corepack', ['pnpm', 'quality:full'], serverDirectory)
}, 180_000)

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('milestone 1 generated stdio server', () => {
  it('negotiates MCP, lists and calls health, then exits cleanly', async () => {
    const harness = await connectStdioTestClient({
      command: node,
      args: ['dist/main.js'],
      cwd: serverDirectory,
      env: environment
    })
    const pid = harness.transport.pid

    expect(harness.protocolVersion()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(harness.client.getServerVersion()).toMatchObject({
      name: 'generated-server',
      version: '0.1.0'
    })
    await expect(harness.client.listTools()).resolves.toMatchObject({
      tools: [
        {
          name: 'health',
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false
          }
        }
      ]
    })
    await expect(
      harness.client.callTool({ name: 'health', arguments: {} })
    ).resolves.toMatchObject({
      structuredContent: { status: 'ok' },
      content: [{ type: 'text', text: '{"status":"ok"}' }]
    })
    await expect(harness.client.listResources()).resolves.toMatchObject({
      resources: [
        {
          name: 'health-status',
          uri: 'health://status',
          mimeType: 'application/json'
        }
      ]
    })
    await expect(
      harness.client.readResource({ uri: 'health://status' })
    ).resolves.toMatchObject({
      contents: [
        {
          uri: 'health://status',
          mimeType: 'application/json',
          text: '{"status":"ok"}'
        }
      ]
    })
    await expect(harness.client.listPrompts()).resolves.toMatchObject({
      prompts: [{ name: 'health-summary', title: 'Health summary' }]
    })
    await expect(
      harness.client.getPrompt({
        name: 'health-summary',
        arguments: { audience: 'operator' }
      })
    ).resolves.toMatchObject({
      description: 'Health summary for operator.',
      messages: [{ role: 'user', content: { type: 'text' } }]
    })

    await harness.close()
    expect(harness.stderr()).toBe('')
    expect(pid).not.toBeNull()
    await expectProcessToExit(pid!)
  })
})

async function run(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd,
      env: environment,
      maxBuffer: 10 * 1024 * 1024
    })
  } catch (error) {
    const result = error as Error & { stdout?: string; stderr?: string }
    throw new Error(
      [result.message, result.stdout, result.stderr].filter(Boolean).join('\n'),
      { cause: error }
    )
  }
}

async function expectProcessToExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Process ${pid} still exists after transport close`)
}
