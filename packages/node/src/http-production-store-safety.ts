import type { RuntimePolicyStores } from '@mcp-kit/core'
import {
  isDevelopmentOnlyStoreAdapter,
  storeAdapterMetadata
} from '@mcp-kit/core'

import type {
  McpAppFactory,
  NormalizedStreamableHttpOptions
} from './http-contracts.js'

const runtimeStoreLabels = {
  rateLimit: 'RateLimitStore',
  concurrency: 'ConcurrencyStore',
  idempotency: 'IdempotencyStore',
  audit: 'AuditStore'
} as const

export function assertProductionStoreSafety<Services>(
  createApp: McpAppFactory<Services>,
  options: NormalizedStreamableHttpOptions
): void {
  if (options.mode !== 'production') return

  let app: ReturnType<McpAppFactory<Services>> | undefined
  const problems: string[] = []
  try {
    if (isDevelopmentOnlyStoreAdapter(options.sessionStore)) {
      problems.push(describeStore('SessionStore', options.sessionStore))
    }
    if (isDevelopmentOnlyStoreAdapter(options.eventStore)) {
      problems.push(
        describeStore('StreamableHttpEventStore', options.eventStore)
      )
    }

    app = createApp()
    const runtimeStores = readRuntimeStores(app)
    if (runtimeStores !== undefined) {
      for (const key of Object.keys(runtimeStoreLabels) as Array<
        keyof typeof runtimeStoreLabels
      >) {
        const store = runtimeStores[key]
        if (isDevelopmentOnlyStoreAdapter(store)) {
          problems.push(describeStore(runtimeStoreLabels[key], store))
        }
      }
    }
  } finally {
    void app?.close()
  }

  if (problems.length === 0) return
  throw new Error(
    `Production Streamable HTTP cannot use development/test stores: ${problems.join(', ')}.`
  )
}

function readRuntimeStores(app: unknown): RuntimePolicyStores | undefined {
  if (typeof app !== 'object' || app === null) return undefined
  const stores = (app as Record<string, unknown>)['__mcpKitRuntimeStores']
  return typeof stores === 'object' && stores !== null
    ? (stores as RuntimePolicyStores)
    : undefined
}

function describeStore(label: string, store: unknown): string {
  const adapter = storeAdapterMetadata(store)?.adapter
  return adapter === undefined ? label : `${label} (${adapter})`
}
