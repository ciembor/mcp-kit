import { defineResource } from '@mcp-kit/core'

import { getHealth } from '../application/get-health.js'

export const healthResource = defineResource({
  name: 'health-status',
  uri: 'health://status',
  title: 'Health status',
  description: 'Current server health as JSON.',
  mimeType: 'application/json',
  read: ({ uri }) => {
    const health = getHealth()
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(health)
        }
      ]
    }
  }
})
