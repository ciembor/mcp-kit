import type { Schema, ToolDefinition } from '@mcp-kit/core'
import { assertRegistryContracts } from './registry-contracts.js'

export function assertToolContracts(
  tools: readonly ToolDefinition<Schema, unknown>[]
): void {
  assertRegistryContracts('tool', tools)
  for (const tool of tools) {
    if (tool.inputSchema === undefined) {
      throw new Error(`Tool "${tool.name}" has no input schema`)
    }
    if (
      tool.policy?.effects === 'write' &&
      tool.annotations?.readOnlyHint !== false
    ) {
      throw new Error(
        `Mutating tool "${tool.name}" must set readOnlyHint to false`
      )
    }
  }
}
