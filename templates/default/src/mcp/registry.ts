import { defineRegistry } from '@mcp-kit/core'

import { healthPrompt } from '../features/health/mcp/health.prompt.js'
import { healthResource } from '../features/health/mcp/health.resource.js'
import { healthTool } from '../features/health/mcp/health.tool.js'

export const tools = defineRegistry([healthTool])
export const resources = defineRegistry([healthResource])
export const prompts = defineRegistry([healthPrompt])
