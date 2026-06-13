import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => void>>
}

const { spawnMock } = vi.hoisted(() => ({
  spawnMock:
    vi.fn<
      (
        program: string,
        args: string[],
        options: Record<string, unknown>
      ) => MockChildProcess
    >()
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

import {
  dirtyPath,
  readGitStatus,
  relativePath,
  releaseDiagnostic,
  runCommand,
  runNpmInstall,
  runNpmPack,
  runNpmPackArchive,
  sanitizeMessage
} from './release-checks-support.js'

afterEach(() => {
  spawnMock.mockReset()
})

describe('release check support helpers', () => {
  it('builds diagnostics and normalizes small string helpers', () => {
    expect(releaseDiagnostic('rule', 'file.ts', 'message')).toEqual({
      rule: 'rule',
      file: 'file.ts',
      message: 'message'
    })
    expect(dirtyPath(' M packages/core/package.json')).toBe(
      'packages/core/package.json'
    )
    expect(dirtyPath('R  old.ts -> new.ts')).toBe('new.ts')
    expect(dirtyPath('??')).toBe('.')
    expect(sanitizeMessage('  hello  ', 'fallback')).toBe('hello')
    expect(sanitizeMessage('   ', 'fallback')).toBe('fallback')
    expect(relativePath('/repo', '/repo/packages/core/index.ts')).toBe(
      'packages/core/index.ts'
    )
    expect(relativePath('/repo', '/other/file.ts')).toBe('/other/file.ts')

    const originalSplit = Object.getOwnPropertyDescriptor(
      String.prototype,
      'split'
    )?.value as ((separator: string) => string[]) | undefined
    String.prototype.split = function split() {
      return { at: () => undefined } as unknown as string[]
    }
    try {
      expect(dirtyPath('R  old.ts -> new.ts')).toBe('old.ts -> new.ts')
    } finally {
      if (originalSplit !== undefined) {
        Object.defineProperty(String.prototype, 'split', {
          value: originalSplit,
          configurable: true,
          writable: true
        })
      }
    }
  })

  it('runs commands and returns captured output', async () => {
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)
    const controller = new AbortController()

    const resultPromise = runCommand('node', ['tool.mjs'], {
      cwd: '/repo',
      signal: controller.signal
    })

    child.stdout.emit('data', 'hello')
    child.stderr.emit('data', 'warning')
    child.emit('exit', 0, null)

    await expect(resultPromise).resolves.toEqual({
      exitCode: 0,
      stdout: 'hello',
      stderr: 'warning'
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['tool.mjs'],
      expect.objectContaining({
        cwd: '/repo',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      })
    )
  })

  it('maps spawn errors and signal exits to stable exit codes', async () => {
    const errorChild = createChild()
    spawnMock.mockReturnValueOnce(errorChild)
    const errorPromise = runCommand('node', [], {
      cwd: '/repo',
      signal: new AbortController().signal
    })
    errorChild.emit('error', new Error('spawn failed'))
    await expect(errorPromise).resolves.toEqual({
      exitCode: 70,
      stdout: '',
      stderr: 'spawn failed'
    })

    const stringErrorChild = createChild()
    spawnMock.mockReturnValueOnce(stringErrorChild)
    const stringErrorPromise = runCommand('node', [], {
      cwd: '/repo',
      signal: new AbortController().signal
    })
    stringErrorChild.emit('error', 'broken')
    await expect(stringErrorPromise).resolves.toEqual({
      exitCode: 70,
      stdout: '',
      stderr: 'broken'
    })

    const sigintChild = createChild()
    spawnMock.mockReturnValueOnce(sigintChild)
    const sigintPromise = runCommand('node', [], {
      cwd: '/repo',
      signal: new AbortController().signal
    })
    sigintChild.emit('exit', null, 'SIGINT')
    await expect(sigintPromise).resolves.toMatchObject({ exitCode: 130 })

    const unknownSignalChild = createChild()
    spawnMock.mockReturnValueOnce(unknownSignalChild)
    const unknownPromise = runCommand('node', [], {
      cwd: '/repo',
      signal: new AbortController().signal
    })
    unknownSignalChild.emit('exit', null, 'SIGHUP')
    await expect(unknownPromise).resolves.toMatchObject({ exitCode: 70 })
  })

  it('kills a running child when the signal aborts', async () => {
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)
    const controller = new AbortController()
    const resultPromise = runCommand('node', [], {
      cwd: '/repo',
      signal: controller.signal
    })

    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('exit', null, 'SIGTERM')

    await expect(resultPromise).resolves.toMatchObject({ exitCode: 143 })
  })

  it('wires npm helpers through runCommand with isolated npm environment', async () => {
    const gitChild = createChild()
    const packChild = createChild()
    const archiveChild = createChild()
    const installChild = createChild()
    spawnMock
      .mockReturnValueOnce(gitChild)
      .mockReturnValueOnce(packChild)
      .mockReturnValueOnce(archiveChild)
      .mockReturnValueOnce(installChild)

    const gitPromise = readGitStatus('/repo', new AbortController().signal)
    gitChild.emit('exit', 0, null)
    await expect(gitPromise).resolves.toMatchObject({ exitCode: 0 })

    const packPromise = runNpmPack('/repo/pkg', new AbortController().signal)
    packChild.emit('exit', 0, null)
    await expect(packPromise).resolves.toMatchObject({ exitCode: 0 })

    const archivePromise = runNpmPackArchive(
      '/repo/pkg',
      '/tmp/tarballs',
      new AbortController().signal
    )
    archiveChild.emit('exit', 0, null)
    await expect(archivePromise).resolves.toMatchObject({ exitCode: 0 })

    const installPromise = runNpmInstall(
      '/repo/install',
      ['one.tgz', 'two.tgz'],
      new AbortController().signal
    )
    installChild.emit('exit', 0, null)
    await expect(installPromise).resolves.toMatchObject({ exitCode: 0 })

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'git',
      ['status', '--short'],
      expect.objectContaining({ cwd: '/repo' })
    )
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'npm',
      ['pack', '--json', '--dry-run'],
      expect.objectContaining({ cwd: '/repo/pkg' })
    )
    const npmPackOptions = spawnMock.mock.calls[1]?.[2] as {
      env?: NodeJS.ProcessEnv
    }
    expect(npmPackOptions.env?.['HOME']).toContain('mcp-kit-npm')
    expect(npmPackOptions.env?.['npm_config_cache']).toContain('cache')
    expect(npmPackOptions.env?.['npm_config_logs_dir']).toContain('logs')
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      'npm',
      ['pack', '--json', '--pack-destination', '/tmp/tarballs'],
      expect.objectContaining({ cwd: '/repo/pkg' })
    )
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-package-lock',
        'one.tgz',
        'two.tgz'
      ],
      expect.objectContaining({ cwd: '/repo/install' })
    )
  })
})

function createChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}
