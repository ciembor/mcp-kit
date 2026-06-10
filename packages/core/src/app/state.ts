import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type {
  AnyResourceDefinition,
  PromptDefinition,
  Schema,
  ToolDefinition
} from '../definitions.js'
import type { AppState, McpAppOptions } from './contracts.js'

export function createAppState<Services>(
  options: McpAppOptions<Services>
): AppState<Services> {
  const sdk = new McpServer(
    { name: options.name, version: options.version },
    options.instructions === undefined
      ? undefined
      : { instructions: options.instructions }
  )
  return {
    sdk,
    tools: new Map<string, ToolDefinition<Schema, Services>>(),
    prompts: new Map<string, PromptDefinition<Schema, Services>>(),
    resources: [] as AnyResourceDefinition<Services>[],
    subscriptions: new Set<string>()
  }
}

export function assertNotConnected(connected: boolean): void {
  if (connected) {
    throw new Error('Capabilities cannot be changed after transport connection')
  }
}
