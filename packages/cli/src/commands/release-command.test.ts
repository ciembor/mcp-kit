import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { exitCodes, type ParsedArgs } from '../cli-contracts.js'
import type { QualityReport } from '../quality.js'
import { prepareRelease } from './release-command.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release command', () => {
  it('publishes only after a successful release quality gate', async () => {
    const root = await makeReleaseRoot('pnpm-lock.yaml')
    const commands: string[] = []

    const result = await prepareRelease(releaseArgs({ publish: true }), root, {
      runQuality: () => Promise.resolve(passedQuality(root)),
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(result.exitCode).toBe(exitCodes.ok)
    expect(result.release).toMatchObject({ status: 'published' })
    expect(commands).toEqual(['corepack pnpm publish -r --access public'])
  })

  it('does not publish when release quality fails', async () => {
    const root = await makeReleaseRoot('pnpm-lock.yaml')
    const commands: string[] = []

    const result = await prepareRelease(releaseArgs({ publish: true }), root, {
      runQuality: () =>
        Promise.resolve({
          ...passedQuality(root),
          status: 'failed'
        } as QualityReport),
      execute: (command) => {
        commands.push(command)
        return Promise.resolve(0)
      }
    })

    expect(result.exitCode).toBe(exitCodes.validation)
    expect(result.release).toMatchObject({ status: 'failed' })
    expect(commands).toEqual([])
  })

  it('selects the workspace publish command for npm', async () => {
    const root = await makeReleaseRoot('package-lock.json')
    const commands: string[] = []

    await expect(
      prepareRelease(releaseArgs({ publish: true }), root, {
        runQuality: () => Promise.resolve(passedQuality(root)),
        execute: (command) => {
          commands.push(command)
          return Promise.resolve(0)
        }
      })
    ).resolves.toMatchObject({
      exitCode: exitCodes.ok,
      release: { status: 'published' }
    })
    expect(commands).toEqual(['npm publish --workspaces --access public'])
  })
})

function releaseArgs(options: { publish?: boolean } = {}): ParsedArgs {
  return {
    command: 'release',
    positionals: [],
    options: options.publish ? { publish: true } : {}
  }
}

function passedQuality(root: string): QualityReport {
  return {
    mode: 'release',
    preset: 'off',
    root,
    status: 'passed',
    durationMs: 1,
    coverage: {
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85
      },
      exclusions: []
    },
    steps: []
  }
}

async function makeReleaseRoot(
  lockfile: 'pnpm-lock.yaml' | 'package-lock.json'
) {
  const root = await mkdtemp(resolve(tmpdir(), 'mcp-kit-release-command-'))
  temporaryDirectories.push(root)
  await mkdir(resolve(root, 'packages/core'), { recursive: true })
  await writeFile(
    resolve(root, 'package.json'),
    JSON.stringify({ name: 'repo', private: true, version: '1.2.3' })
  )
  await writeFile(resolve(root, lockfile), '')
  return root
}
