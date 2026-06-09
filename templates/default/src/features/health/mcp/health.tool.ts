import { defineTool } from '@mcp-kit/core'
import { z } from 'zod'

import { getHealth } from '../application/get-health.js'

export const healthTool = defineTool({
  name: 'health',
  title: 'Health',
  description: 'Report whether the MCP server is healthy.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    status: z.literal('ok')
  }),
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  policy: {
    effects: 'read'
  },
  handler: () => {
    const health = getHealth()
    return {
      structuredContent: health,
      content: [{ type: 'text', text: JSON.stringify(health) }]
    }
  }
})
