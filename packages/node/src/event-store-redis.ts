import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { RedisLikeClient } from '@mcp-kit/core'

import type { StreamableHttpEventStore } from './http-contracts.js'

type StoredEvent = {
  message: JSONRPCMessage
  streamId: string
}

export function createRedisEventStore(
  client: RedisLikeClient,
  options: {
    eventKeyPrefix?: string
    sequenceKey?: string
    streamKeyPrefix?: string
    ttlMs?: number
  } = {}
): StreamableHttpEventStore {
  const eventKeyPrefix = options.eventKeyPrefix ?? 'mcp-kit:events:item:'
  const sequenceKey = options.sequenceKey ?? 'mcp-kit:events:sequence'
  const streamKeyPrefix = options.streamKeyPrefix ?? 'mcp-kit:events:stream:'
  const ttlMs = options.ttlMs ?? 3_600_000

  return {
    async storeEvent(streamId, message) {
      const sequence = await client.incr(sequenceKey)
      const eventId = `${streamId}_${sequence}`
      await client.set(
        `${eventKeyPrefix}${eventId}`,
        JSON.stringify({ streamId, message } satisfies StoredEvent),
        { px: ttlMs }
      )
      await client.set(`${eventKeyPrefix}stream:${eventId}`, streamId, {
        px: ttlMs
      })
      const streamKey = `${streamKeyPrefix}${streamId}`
      await client.zadd(streamKey, sequence, eventId)
      await client.pexpire(streamKey, ttlMs)
      return eventId
    },
    getStreamIdForEventId(eventId) {
      return client.get(`${eventKeyPrefix}stream:${eventId}`) as Promise<
        string | undefined
      >
    },
    async replayEventsAfter(lastEventId, { send }) {
      const streamId =
        (await client.get(`${eventKeyPrefix}stream:${lastEventId}`)) ?? ''
      if (streamId === '') return ''

      const lastSequence = eventSequence(lastEventId)
      const eventIds = await client.zrangebyscore(
        `${streamKeyPrefix}${streamId}`,
        lastSequence + 1,
        Number.POSITIVE_INFINITY
      )
      for (const eventId of eventIds) {
        const encoded = await client.get(`${eventKeyPrefix}${eventId}`)
        if (encoded === null) continue
        const event = JSON.parse(encoded) as StoredEvent
        await send(eventId, event.message)
      }
      return streamId
    }
  }
}

function eventSequence(eventId: string): number {
  const separator = eventId.lastIndexOf('_')
  return separator === -1 ? 0 : Number(eventId.slice(separator + 1))
}
