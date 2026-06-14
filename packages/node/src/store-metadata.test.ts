import { describe, expect, it } from 'vitest'

import { createInMemoryEventStore } from './event-store.js'
import { createInMemorySessionStore } from './session-store.js'
import { storeAdapterMetadata } from './store-adapter-metadata.js'

describe('node in-memory store metadata', () => {
  it('marks session and event stores as development-and-test adapters', () => {
    const adapters = [createInMemorySessionStore(), createInMemoryEventStore()]

    for (const adapter of adapters) {
      expect(storeAdapterMetadata(adapter)?.support).toBe(
        'development-and-test'
      )
    }
  })
})
