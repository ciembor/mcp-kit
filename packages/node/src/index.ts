import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { McpApp } from '@mcp-kit/core'
export { runStreamableHttp } from './http-node.js'
export { createInMemorySessionStore } from './session-store.js'
export type {
  DeploymentMode,
  ManagedSession,
  McpAppFactory,
  SessionStore,
  SessionMode,
  StreamableHttpAuthOptions,
  StreamableHttpCorsOptions,
  StreamableHttpOptions,
  StreamableHttpRuntime
} from './http-contracts.js'
import { createStderrLogger } from './stderr-logger.js'

export const packageInfo = {
  name: '@mcp-kit/node',
  version: '0.0.0'
} as const

export type StdioRuntime = {
  close(): Promise<void>
}
export { createStderrLogger } from './stderr-logger.js'

export async function runStdio<Services>(
  app: McpApp<Services>
): Promise<StdioRuntime> {
  app.setLogger(createStderrLogger())
  const transport = new StdioServerTransport()
  let closing: Promise<void> | undefined

  const close = (): Promise<void> => {
    closing ??= (async () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      await app.close()
    })()
    return closing
  }

  const onSignal = (): void => {
    const signalClose = close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[error] Failed to close MCP server: ${message}\n`)
      process.exitCode = 1
    })
    closing = signalClose
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    await app.connect(transport)
  } catch (error) {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    throw error
  }

  return { close }
}
