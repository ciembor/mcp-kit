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
  createInMemoryRateLimitStore,
  createPostgresAuditStore,
  createPostgresIdempotencyStore,
  createPostgresJobStore
} from './index.js'
import { FakePostgresClient } from './testing/fake-postgres-client.js'

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

  it('marks postgres adapters as production-ready', () => {
    const client = new FakePostgresClient()
    const adapters = [
      createPostgresAuditStore(client),
      createPostgresIdempotencyStore(client),
      createPostgresJobStore(client)
    ]

    for (const adapter of adapters) {
      expect(isDevelopmentOnlyStoreAdapter(adapter)).toBe(false)
      expect(storeAdapterMetadata(adapter)?.support).toBe('production')
    }
  })
})
