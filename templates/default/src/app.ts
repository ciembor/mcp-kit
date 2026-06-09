import { createMcpApp } from '@mcp-kit/core'

import { prompts, resources, tools } from './mcp/registry.js'

export const app = createMcpApp({
  name: '{{PROJECT_NAME}}',
  version: '0.1.0',
  services: {}
})

app.tools(tools)
app.resources(resources)
app.prompts(prompts)
