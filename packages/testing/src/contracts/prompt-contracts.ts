import type { PromptDefinition, Schema } from '@mcp-kit/core'
import { assertRegistryContracts } from './registry-contracts.js'

export function assertPromptContracts(
  prompts: readonly PromptDefinition<Schema, unknown>[]
): void {
  assertRegistryContracts('prompt', prompts)
  for (const prompt of prompts) {
    if (prompt.argsSchema === undefined) {
      throw new Error(`Prompt "${prompt.name}" has no args schema`)
    }
  }
}
