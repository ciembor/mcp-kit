import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exitCodes, type ParsedArgs } from '../cli-contracts.js'

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => void>>
}

const temporaryDirectories: string[] = []

const {
  spawnMock,
  detectProjectRootMock,
  detectPackageManagerMock,
  runQualityMock,
  executeCommandMock
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  detectProjectRootMock: vi.fn(),
  detectPackageManagerMock: vi.fn(),
  runQualityMock: vi.fn(),
  executeCommandMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('../cli-files.js', () => ({
  detectProjectRoot: detectProjectRootMock,
  detectPackageManager: detectPackageManagerMock
}))

vi.mock('../quality.js', () => ({
  runQuality: runQualityMock,
  executeCommand: executeCommandMock
}))

import { prepareRelease } from './release-command.js'

beforeEach(() => {
  spawnMock.mockReset()
  detectProjectRootMock.mockReset()
  detectPackageManagerMock.mockReset()
  runQualityMock.mockReset()
  executeCommandMock.mockReset()

  detectProjectRootMock.mockResolvedValue('/repo')
  detectPackageManagerMock.mockReturnValue('pnpm')
  runQualityMock.mockResolvedValue(passedQuality('/repo'))
  executeCommandMock.mockResolvedValue(0)
})

afterEach(() => {
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('release command branches', () => {
  it('rejects unsupported arguments', async () => {
    await expect(
      prepareRelease(
        {
          command: 'release',
          positionals: ['extra'],
          options: {}
        },
        '/repo'
      )
    ).rejects.toMatchObject({
      message: 'Usage: mcp-kit release [--publish]',
      exitCode: exitCodes.usage
    })

    await expect(
      prepareRelease(
        {
          command: 'release',
          positionals: [],
          options: { dryRun: true }
        } as ParsedArgs,
        '/repo'
      )
    ).rejects.toMatchObject({
      message: 'Usage: mcp-kit release [--publish]',
      exitCode: exitCodes.usage
    })
  })

  it('returns prepared when publish is disabled', async () => {
    const result = await prepareRelease(releaseArgs(), '/repo')

    expect(result.exitCode).toBe(exitCodes.ok)
    expect(result.release).toMatchObject({ status: 'prepared' })
    expect(runQualityMock).toHaveBeenCalledWith({
      root: '/repo',
      mode: 'release',
      signal: expect.any(AbortSignal)
    })
    expect(executeCommandMock).not.toHaveBeenCalled()
  })

  it('publishes through default dependencies and trims the current branch', async () => {
    const root = await makeReleaseRoot('pnpm-lock.yaml')
    detectProjectRootMock.mockResolvedValueOnce(root)
    runQualityMock.mockResolvedValueOnce(passedQuality(root))
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)

    const promise = prepareRelease(releaseArgs({ publish: true }), root)
    await flushAsyncWork()
    child.stdout.emit('data', 'main\n')
    child.emit('exit', 0, null)

    await expect(promise).resolves.toMatchObject({
      exitCode: exitCodes.ok,
      release: { status: 'published' }
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'git',
      ['branch', '--show-current'],
      expect.objectContaining({
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    )
    expect(executeCommandMock).toHaveBeenCalledWith(
      'corepack pnpm publish -r --access public --provenance',
      expect.objectContaining({ cwd: root })
    )
  })

  it('uses the npm-style publish command for yarn and reports publish failures', async () => {
    const root = await makeReleaseRoot('yarn.lock')
    detectProjectRootMock.mockResolvedValueOnce(root)
    runQualityMock.mockResolvedValueOnce(passedQuality(root))
    detectPackageManagerMock.mockReturnValueOnce('yarn')
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)
    executeCommandMock.mockResolvedValueOnce(1)

    const promise = prepareRelease(releaseArgs({ publish: true }), root)
    await flushAsyncWork()
    child.stdout.emit('data', 'main')
    child.emit('exit', 0, null)

    await expect(promise).resolves.toMatchObject({
      exitCode: exitCodes.validation,
      release: { status: 'failed' }
    })
    expect(executeCommandMock).toHaveBeenCalledWith(
      'npm publish --workspaces --access public --provenance',
      expect.any(Object)
    )
  })

  it('allows publishing when the root version is missing or non-string', async () => {
    const root = await makeReleaseRoot('pnpm-lock.yaml', 123)
    detectProjectRootMock.mockResolvedValueOnce(root)
    runQualityMock.mockResolvedValueOnce(passedQuality(root))
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)

    const promise = prepareRelease(releaseArgs({ publish: true }), root)
    await flushAsyncWork()
    child.stdout.emit('data', 'main')
    child.emit('exit', 0, null)

    await expect(promise).resolves.toMatchObject({
      exitCode: exitCodes.ok,
      release: { status: 'published' }
    })
  })

  it('treats an empty branch as detached HEAD', async () => {
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)

    const promise = prepareRelease(releaseArgs({ publish: true }), '/repo')
    await flushAsyncWork()
    child.stdout.emit('data', '\n')
    child.emit('exit', 0, null)

    await expect(promise).rejects.toMatchObject({
      message:
        'Release publishing is only allowed from main, received detached HEAD',
      exitCode: exitCodes.validation
    })
  })

  it('maps git branch command failures, errors, and signals to validation errors', async () => {
    const exitFailure = createChild()
    spawnMock.mockReturnValueOnce(exitFailure)
    const exitPromise = prepareRelease(releaseArgs({ publish: true }), '/repo')
    await flushAsyncWork()
    exitFailure.stderr.emit('data', 'branch failed')
    exitFailure.emit('exit', 1, null)
    await expect(exitPromise).rejects.toMatchObject({
      message: 'Could not determine the current git branch: branch failed',
      exitCode: exitCodes.validation
    })

    const errorChild = createChild()
    spawnMock.mockReturnValueOnce(errorChild)
    const errorPromise = prepareRelease(releaseArgs({ publish: true }), '/repo')
    await flushAsyncWork()
    errorChild.emit('error', new Error('broken'))
    await expect(errorPromise).rejects.toMatchObject({
      message: 'Could not determine the current git branch: broken',
      exitCode: exitCodes.validation
    })

    const nonErrorChild = createChild()
    spawnMock.mockReturnValueOnce(nonErrorChild)
    const nonErrorPromise = prepareRelease(
      releaseArgs({ publish: true }),
      '/repo'
    )
    await flushAsyncWork()
    nonErrorChild.emit('error', 123)
    await expect(nonErrorPromise).rejects.toMatchObject({
      message: 'Could not determine the current git branch: 123',
      exitCode: exitCodes.validation
    })

    const sigintChild = createChild()
    spawnMock.mockReturnValueOnce(sigintChild)
    const sigintPromise = prepareRelease(releaseArgs({ publish: true }), '/repo')
    await flushAsyncWork()
    sigintChild.emit('exit', null, 'SIGINT')
    await expect(sigintPromise).rejects.toMatchObject({
      message: 'Could not determine the current git branch: unknown error',
      exitCode: exitCodes.validation
    })

    const sigtermChild = createChild()
    spawnMock.mockReturnValueOnce(sigtermChild)
    const sigtermPromise = prepareRelease(releaseArgs({ publish: true }), '/repo')
    await flushAsyncWork()
    process.emit('SIGTERM')
    expect(sigtermChild.kill).toHaveBeenCalledWith('SIGTERM')
    sigtermChild.emit('exit', null, 'SIGTERM')
    await expect(sigtermPromise).rejects.toMatchObject({
      message: 'Could not determine the current git branch: unknown error',
      exitCode: exitCodes.validation
    })

    const unknownSignalChild = createChild()
    spawnMock.mockReturnValueOnce(unknownSignalChild)
    const unknownSignalPromise = prepareRelease(
      releaseArgs({ publish: true }),
      '/repo'
    )
    await flushAsyncWork()
    unknownSignalChild.emit('exit', null, 'SIGHUP')
    await expect(unknownSignalPromise).rejects.toMatchObject({
      message: 'Could not determine the current git branch: unknown error',
      exitCode: exitCodes.validation
    })
  })
})

function releaseArgs(options: { publish?: boolean } = {}): ParsedArgs {
  return {
    command: 'release',
    positionals: [],
    options: options.publish ? { publish: true } : {}
  }
}

function passedQuality(root: string) {
  return {
    mode: 'release' as const,
    preset: 'off' as const,
    root,
    status: 'passed' as const,
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

function createChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function makeReleaseRoot(
  lockfile: 'pnpm-lock.yaml' | 'yarn.lock',
  version: string | number = '1.2.3'
) {
  const root = await mkdtemp(
    resolve(tmpdir(), 'mcp-kit-release-command-branches-')
  )
  temporaryDirectories.push(root)
  await mkdir(resolve(root, 'packages/core'), { recursive: true })
  await writeFile(
    resolve(root, 'package.json'),
    JSON.stringify({ name: 'repo', private: true, version })
  )
  await writeFile(resolve(root, lockfile), '')
  return root
}
