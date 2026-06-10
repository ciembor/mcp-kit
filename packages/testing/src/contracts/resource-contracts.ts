import type { AnyResourceDefinition } from '@mcp-kit/core'
import { assertRegistryContracts } from './registry-contracts.js'

export function assertResourceContracts(
  resources: readonly { name: string }[]
): void {
  assertRegistryContracts('resource', resources)
  for (const resource of resources as readonly AnyResourceDefinition<unknown>[]) {
    const candidate = resource as {
      name: string
      uri?: string
      uriTemplate?: string
    }
    if (candidate.uri === undefined && candidate.uriTemplate === undefined) {
      throw new Error(`Resource "${candidate.name}" has no URI`)
    }
  }
}
