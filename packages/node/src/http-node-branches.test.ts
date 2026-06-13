import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockServer = EventEmitter & {
  requestTimeout: number
  listen: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  address: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  requestListener?: (req: unknown, res: unknown) => void
}

type MockNodeRuntime = {
  options: {
    host: string
    path: string
    port: number
    requestTimeoutMs: number
  }
  handle: ReturnType<
    typeof vi.fn<(req: unknown, res: unknown) => Promise<void>>
  >
  drain: ReturnType<typeof vi.fn<() => Promise<void>>>
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
}

const {
  createServerMock,
  createNodeHttpRuntimeMock,
  stderrWriteMock,
  processOnceMock,
  processOffMock
} = vi.hoisted(() => ({
  createServerMock:
    vi.fn<(listener: (req: unknown, res: unknown) => void) => MockServer>(),
  createNodeHttpRuntimeMock:
    vi.fn<
      (
        createApp: unknown,
        options: { host?: string; path?: string; port?: number }
      ) => MockNodeRuntime
    >(),
  stderrWriteMock: vi.fn(() => true),
  processOnceMock: vi.fn(),
  processOffMock: vi.fn()
}))

vi.mock('node:http', () => ({
  createServer: createServerMock
}))

vi.mock('./http-node-runtime.js', () => ({
  createNodeHttpRuntime: createNodeHttpRuntimeMock
}))

import { runStreamableHttp } from './http-node.js'

beforeEach(() => {
  createServerMock.mockReset()
  createNodeHttpRuntimeMock.mockReset()
  stderrWriteMock.mockReset()
  processOnceMock.mockReset()
  processOffMock.mockReset()

  vi.spyOn(process.stderr, 'write').mockImplementation(stderrWriteMock)
  vi.spyOn(process, 'once').mockImplementation(processOnceMock)
  vi.spyOn(process, 'off').mockImplementation(processOffMock)
  process.exitCode = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('runStreamableHttp branches', () => {
  it('falls back to the configured port when server.address is not an object', async () => {
    const server = createServer()
    server.address.mockReturnValueOnce(null)
    createServerMock.mockImplementationOnce((listener) => {
      server.requestListener = listener
      return server
    })
    createNodeHttpRuntimeMock.mockImplementationOnce((_createApp, options) =>
      createRuntime({
        options: {
          host: options.host ?? '127.0.0.1',
          path: options.path ?? '/mcp',
          port: options.port ?? 8123,
          requestTimeoutMs: 5_000
        }
      })
    )

    const result = await runStreamableHttp(vi.fn(), {
      host: '127.0.0.1',
      path: '/custom',
      port: 4312
    })

    expect(result.url).toBe('http://127.0.0.1:4312/custom')
    expect(server.requestTimeout).toBe(5_000)
    await result.close()
  })

  it('logs request handler failures and non-Error close failures from signal shutdown', async () => {
    const server = createServer({
      close: vi.fn((callback: (error?: Error | null) => void) => {
        callback('close failed' as never)
      })
    })
    const runtime = createRuntime({
      handle: vi.fn(() => Promise.reject(new Error('request failed'))),
      close: vi.fn(() => Promise.resolve())
    })
    let sigtermHandler: (() => void) | undefined

    createServerMock.mockImplementationOnce((listener) => {
      server.requestListener = listener
      return server
    })
    createNodeHttpRuntimeMock.mockReturnValueOnce(runtime)
    processOnceMock.mockImplementation((event, handler) => {
      if (event === 'SIGTERM') sigtermHandler = handler as () => void
      return process
    })

    const result = await runStreamableHttp(vi.fn(), { port: 8123 })
    server.requestListener?.({}, {})
    await flushAsyncWork()

    expect(stderrWriteMock).toHaveBeenCalledWith(
      '[error] Failed to close MCP HTTP server: request failed\n'
    )

    sigtermHandler?.()
    await expect(result.close()).rejects.toBe('close failed')
    await flushAsyncWork()

    expect(stderrWriteMock).toHaveBeenCalledWith(
      '[error] Failed to close MCP HTTP server: close failed\n'
    )
    expect(process.exitCode).toBe(1)
  })

  it('rejects close when server.close reports an error and memoizes the same promise', async () => {
    const server = createServer({
      close: vi.fn((callback: (error?: Error | null) => void) => {
        callback(new Error('socket stuck'))
      })
    })
    const runtime = createRuntime()

    createServerMock.mockImplementationOnce((listener) => {
      server.requestListener = listener
      return server
    })
    createNodeHttpRuntimeMock.mockReturnValueOnce(runtime)

    const result = await runStreamableHttp(vi.fn(), { port: 9000 })
    const firstClose = result.close()
    const secondClose = result.close()

    expect(firstClose).toBe(secondClose)
    await expect(firstClose).rejects.toThrow('socket stuck')
    expect(runtime.drain).toHaveBeenCalledTimes(1)
    expect(runtime.close).toHaveBeenCalledTimes(1)
    expect(processOffMock).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(processOffMock).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
  })
})

function createServer(overrides: Partial<MockServer> = {}): MockServer {
  const server = new EventEmitter() as MockServer
  server.requestTimeout = 0
  server.listen = vi.fn((port: number, _host: string, onListen: () => void) => {
    onListen()
    return server
  })
  server.once = vi.fn(
    (event: string, handler: (...args: unknown[]) => void) => {
      EventEmitter.prototype.once.call(server, event, handler)
      return server
    }
  )
  server.off = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    EventEmitter.prototype.off.call(server, event, handler)
    return server
  })
  server.address = vi.fn(() => ({ port: 8123 }))
  server.close = vi.fn((callback: (error?: Error | null) => void) => {
    callback(null)
    return server
  })
  return Object.assign(server, overrides)
}

function createRuntime(
  overrides: Partial<MockNodeRuntime> = {}
): MockNodeRuntime {
  return {
    options: {
      host: '127.0.0.1',
      path: '/mcp',
      port: 8123,
      requestTimeoutMs: 5_000
    },
    handle: vi.fn(() => Promise.resolve()),
    drain: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    ...overrides
  }
}

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}
