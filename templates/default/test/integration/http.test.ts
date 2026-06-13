import { runStreamableHttp } from '@mcp-kit/node'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { startHttp } from '../../src/server/transports/http.js'

vi.mock('@mcp-kit/node', () => ({
  runStreamableHttp: vi.fn()
}))

describe('http entrypoint', () => {
  afterEach(() => {
    delete process.env['NODE_ENV']
    delete process.env['MCP_HOST']
    delete process.env['MCP_PORT']
    delete process.env['MCP_PATH']
    delete process.env['MCP_TRUSTED_PROXIES']
    delete process.env['MCP_ALLOWED_HOSTS']
    delete process.env['MCP_ALLOWED_ORIGINS']
    delete process.env['MCP_CORS']
  })

  it('starts the HTTP transport with safe defaults', async () => {
    await startHttp()

    expect(runStreamableHttp).toHaveBeenCalledOnce()
    expect(runStreamableHttp).toHaveBeenCalledWith(expect.any(Function), {
      mode: 'development',
      cors: false
    })
  })

  it('forwards explicit HTTP environment configuration', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['MCP_HOST'] = '0.0.0.0'
    process.env['MCP_PORT'] = '8080'
    process.env['MCP_PATH'] = '/custom'
    process.env['MCP_TRUSTED_PROXIES'] = '127.0.0.1, 10.0.0.1'
    process.env['MCP_ALLOWED_HOSTS'] = 'example.com, api.example.com'
    process.env['MCP_ALLOWED_ORIGINS'] = 'https://example.com'
    process.env['MCP_CORS'] = 'true'

    await startHttp()

    expect(runStreamableHttp).toHaveBeenLastCalledWith(expect.any(Function), {
      mode: 'production',
      host: '0.0.0.0',
      port: 8080,
      path: '/custom',
      trustedProxies: ['127.0.0.1', '10.0.0.1'],
      allowedHosts: ['example.com', 'api.example.com'],
      allowedOrigins: ['https://example.com'],
      cors: {}
    })
  })
})
