import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpApp } from '@mcp-kit/core'

const transportInstances: MockStdioServerTransport[] = []

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockStdioServerTransport {
    constructor() {
      transportInstances.push(this)
    }
  }
}))

import { createStderrLogger, runStdio } from './index.js'

class MockStdioServerTransport {}

afterEach(() => {
  transportInstances.splice(0)
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('@mcp-kit/node stdio logging', () => {
  it('writes every application log level to stderr and never stdout', () => {
    let stderr = ''
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr += chunk.toString()
        return true
      })
    const stdoutSpy = vi.spyOn(process.stdout, 'write')
    const logger = createStderrLogger()

    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error', { requestId: '42' })

    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(stderr).toContain('[debug] debug')
    expect(stderr).toContain('[info] info')
    expect(stderr).toContain('[warn] warn')
    expect(stderr).toContain('[error] error {"requestId":"42"}')

    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('connects stdio, sets a stderr logger and closes once', async () => {
    const app = {
      setLogger: vi.fn(),
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    }

    const runtime = await runStdio(app as unknown as McpApp<unknown>)
    await runtime.close()
    await runtime.close()

    expect(app.setLogger).toHaveBeenCalled()
    expect(app.connect).toHaveBeenCalledWith(transportInstances[0])
    expect(app.close).toHaveBeenCalledTimes(1)
  })

  it('removes signal handlers when connect fails', async () => {
    const error = new Error('connect failed')
    const app = {
      setLogger: vi.fn(),
      connect: vi.fn<() => Promise<void>>().mockRejectedValue(error),
      close: vi.fn<() => Promise<void>>()
    }
    const offSpy = vi.spyOn(process, 'off')

    await expect(runStdio(app as unknown as McpApp<unknown>)).rejects.toThrow(
      error
    )

    expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
  })

  it('logs close failures from signal handlers safely', async () => {
    let sigintHandler: (() => void) | undefined
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    vi.spyOn(process, 'once').mockImplementation((event, handler) => {
      if (event === 'SIGINT') sigintHandler = handler as () => void
      return process
    })
    const app = {
      setLogger: vi.fn(),
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      close: vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error('cannot close'))
    }

    await runStdio(app as unknown as McpApp<unknown>)
    sigintHandler?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stderrSpy).toHaveBeenCalledWith(
      '[error] Failed to close MCP server: cannot close\n'
    )
    expect(process.exitCode).toBe(1)
  })

  it('logs non-Error close failures from signal handlers', async () => {
    let sigtermHandler: (() => void) | undefined
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    vi.spyOn(process, 'once').mockImplementation((event, handler) => {
      if (event === 'SIGTERM') sigtermHandler = handler as () => void
      return process
    })
    const app = {
      setLogger: vi.fn(),
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      close: vi.fn<() => Promise<void>>().mockRejectedValue('string failure')
    }

    await runStdio(app as unknown as McpApp<unknown>)
    sigtermHandler?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stderrSpy).toHaveBeenCalledWith(
      '[error] Failed to close MCP server: string failure\n'
    )
  })
})
