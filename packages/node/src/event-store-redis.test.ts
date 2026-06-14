import { describe, expect, it } from 'vitest'

import { FakeRedisClient } from '../../core/src/testing/fake-redis-client.js'
import { createRedisEventStore } from './event-store-redis.js'

describe('createRedisEventStore', () => {
  it('replays events across adapter instances sharing the same redis client', async () => {
    const client = new FakeRedisClient()
    const writer = createRedisEventStore(client)
    const reader = createRedisEventStore(client)

    const first = await writer.storeEvent('stream-a', {
      jsonrpc: '2.0',
      method: 'first'
    })
    await writer.storeEvent('stream-a', {
      jsonrpc: '2.0',
      method: 'second'
    })
    await writer.storeEvent('stream-a', {
      jsonrpc: '2.0',
      method: 'third'
    })
    const replayed: string[] = []

    await expect(
      reader.replayEventsAfter(first, {
        send: async (eventId, message) => {
          replayed.push(`${eventId}:${eventMethod(message)}`)
        }
      })
    ).resolves.toBe('stream-a')
    expect(replayed).toEqual(['stream-a_2:second', 'stream-a_3:third'])
  })
})

function eventMethod(message: object): string {
  return 'method' in message ? String(message.method) : 'unknown'
}
