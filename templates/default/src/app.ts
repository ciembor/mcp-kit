import { createMcpApp } from '@mcp-kit/core'

import { prompts, resources, tools } from './mcp/registry.js'

export function createApp() {
  const app = createMcpApp({
    name: '{{PROJECT_NAME}}',
    version: '0.1.0',
    services: {}
  })

  app.tools(tools)
  app.resources(resources)
  app.prompts(prompts)

  return app
}

export const app = createApp()
