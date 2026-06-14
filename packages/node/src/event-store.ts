import { randomUUID } from 'node:crypto'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import type { StreamableHttpEventStore } from './http-contracts.js'
import { defineStoreAdapterMetadata } from './store-adapter-metadata.js'

type StoredEvent = {
  streamId: string
  message: JSONRPCMessage
}

export function createInMemoryEventStore(): StreamableHttpEventStore {
  const events = new Map<string, StoredEvent>()

  return defineStoreAdapterMetadata(
    {
      storeEvent(streamId, message) {
        const eventId = `${streamId}_${randomUUID()}`
        events.set(eventId, { streamId, message })
        return Promise.resolve(eventId)
      },
      getStreamIdForEventId(eventId) {
        return Promise.resolve(events.get(eventId)?.streamId)
      },
      async replayEventsAfter(lastEventId, { send }) {
        const lastEvent = events.get(lastEventId)
        if (lastEvent === undefined) return ''

        let replaying = false
        const ordered = [...events.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        )

        for (const [eventId, event] of ordered) {
          if (event.streamId !== lastEvent.streamId) continue
          if (eventId === lastEventId) {
            replaying = true
            continue
          }
          if (!replaying) continue
          await send(eventId, event.message)
        }

        return lastEvent.streamId
      }
    },
    {
      adapter: 'InMemoryStreamableHttpEventStore',
      support: 'development-and-test'
    }
  )
}
