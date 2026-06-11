import { runStreamableHttp } from '@mcp-kit/node'

import { createApp } from '../../app.js'

export async function startHttp(): Promise<void> {
  await runStreamableHttp(createApp, {
    mode:
      process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
    host: process.env['MCP_HOST'],
    port: parsePort(process.env['MCP_PORT']),
    path: process.env['MCP_PATH'],
    trustedProxies: csv(process.env['MCP_TRUSTED_PROXIES']),
    allowedHosts: csv(process.env['MCP_ALLOWED_HOSTS']),
    allowedOrigins: csv(process.env['MCP_ALLOWED_ORIGINS']),
    cors: process.env['MCP_CORS'] === 'true' ? {} : false
  })
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
