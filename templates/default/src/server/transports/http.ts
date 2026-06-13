import { runStreamableHttp, type StreamableHttpOptions } from '@mcp-kit/node'

import { createApp } from '../../app.js'

export async function startHttp(): Promise<void> {
  await runStreamableHttp(createApp, httpOptionsFromEnv())
}

function httpOptionsFromEnv(): StreamableHttpOptions {
  return {
    mode:
      process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
    ...optionalField('host', process.env['MCP_HOST']),
    ...optionalField('port', parsePort(process.env['MCP_PORT'])),
    ...optionalField('path', process.env['MCP_PATH']),
    ...optionalField('trustedProxies', csv(process.env['MCP_TRUSTED_PROXIES'])),
    ...optionalField('allowedHosts', csv(process.env['MCP_ALLOWED_HOSTS'])),
    ...optionalField('allowedOrigins', csv(process.env['MCP_ALLOWED_ORIGINS'])),
    cors: process.env['MCP_CORS'] === 'true' ? {} : false
  }
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === '') return undefined
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const port = Number.parseInt(value, 10)
  return Number.isFinite(port) ? port : undefined
}

function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>)
}
