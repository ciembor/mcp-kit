import { createServer } from 'node:http'

import type {
  McpAppFactory,
  StreamableHttpOptions,
  StreamableHttpRuntime
} from './http-contracts.js'
import { createNodeHttpRuntime } from './http-node-runtime.js'

export async function runStreamableHttp<Services>(
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): Promise<StreamableHttpRuntime> {
  const runtime = createNodeHttpRuntime(createApp, options)
  const server = createServer((req, res) => {
    void runtime.handle(req, res)
  })
  server.requestTimeout = runtime.options.requestTimeoutMs

  let port = runtime.options.port
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(runtime.options.port, runtime.options.host, () => {
      server.off('error', reject)
      const address = server.address()
      port =
        typeof address === 'object' && address !== null
          ? address.port
          : runtime.options.port
      resolve()
    })
  })
  const runtimeOptions = { ...runtime.options, port }

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    closing ??= (async () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      await runtime.drain()
      await runtime.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    })()
    return closing
  }

  const onSignal = (): void => {
    void close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(
        `[error] Failed to close MCP HTTP server: ${message}\n`
      )
      process.exitCode = 1
    })
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  return {
    url: `http://${runtime.options.host}:${port}${runtime.options.path}`,
    options: runtimeOptions,
    drain: () => runtime.drain(),
    close
  }
}
