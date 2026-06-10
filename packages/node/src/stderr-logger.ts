import type { Logger } from '@mcp-kit/core'

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
