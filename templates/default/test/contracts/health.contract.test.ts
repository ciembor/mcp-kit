import { createMcpTestClient } from '@mcp-kit/testing'
import { describe, expect, it } from 'vitest'

import { app } from '../../src/app.js'

describe('health MCP contracts', () => {
  it('serves its tool, resource and prompt through MCP', async () => {
    const harness = await createMcpTestClient(app)
    await expect(
      harness.client.callTool({ name: 'health', arguments: {} })
    ).resolves.toMatchObject({
      structuredContent: { status: 'ok' }
    })
    await expect(
      harness.client.readResource({ uri: 'health://status' })
    ).resolves.toMatchObject({
      contents: [{ text: '{"status":"ok"}' }]
    })
    await expect(
      harness.client.getPrompt({
        name: 'health-summary',
        arguments: { audience: 'operator' }
      })
    ).resolves.toMatchObject({
      description: 'Health summary for operator.'
    })
    await harness.close()
  })
})
