import { describe, expect, it } from 'vitest'

import {
  isDevelopmentOnlyStoreAdapter,
  storeAdapterMetadata
} from './store-adapter-metadata.js'
import {
  createInMemoryAuditStore,
  createInMemoryConcurrencyStore,
  createInMemoryIdempotencyStore,
  createInMemoryJobQueue,
  createInMemoryJobStore,
  createInMemoryRateLimitStore
} from './index.js'

describe('store adapter metadata', () => {
  it('marks core in-memory adapters as development-and-test only', () => {
    const adapters = [
      createInMemoryAuditStore(),
      createInMemoryConcurrencyStore(),
      createInMemoryIdempotencyStore(),
      createInMemoryJobQueue(),
      createInMemoryJobStore(),
      createInMemoryRateLimitStore()
    ]

    for (const adapter of adapters) {
      expect(isDevelopmentOnlyStoreAdapter(adapter)).toBe(true)
      expect(storeAdapterMetadata(adapter)?.support).toBe(
        'development-and-test'
      )
    }
  })
})
