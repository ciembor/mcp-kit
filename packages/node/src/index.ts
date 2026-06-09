import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Logger, McpApp } from '@mcp-kit/core'

export const packageInfo = {
  name: '@mcp-kit/node',
  version: '0.0.0'
} as const

export type StdioRuntime = {
  close(): Promise<void>
}

export function createStderrLogger(): Logger {
  const write = (
    level: string,
    message: string,
    data?: Record<string, unknown>
  ): void => {
    const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`
    process.stderr.write(`[${level}] ${message}${suffix}\n`)
  }

  return {
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data)
  }
}

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
    void close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[error] Failed to close MCP server: ${message}\n`)
      process.exitCode = 1
    })
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
