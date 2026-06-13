import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'

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
  const server = createServer(createRequestListener(runtime))
  server.requestTimeout = runtime.options.requestTimeoutMs

  const port = await listen(server, runtime.options.port, runtime.options.host)
  const runtimeOptions = { ...runtime.options, port }

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    closing ??= (async () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      await runtime.drain()
      await runtime.close()
      await closeServer(server)
    })()
    return closing
  }

  const onSignal = (): void => {
    close().catch(reportCloseError)
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

function createRequestListener<Services>(
  runtime: ReturnType<typeof createNodeHttpRuntime<Services>>
) {
  return (req: IncomingMessage, res: ServerResponse) => {
    runtime.handle(req, res).catch(reportCloseError)
  }
}

async function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  host: string
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      const address = server.address()
      resolve(
        typeof address === 'object' && address !== null ? address.port : port
      )
    })
  })
}

async function closeServer(
  server: ReturnType<typeof createServer>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function reportCloseError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[error] Failed to close MCP HTTP server: ${message}\n`)
  process.exitCode = 1
}
