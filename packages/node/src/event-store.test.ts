import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

const { randomUUIDMock } = vi.hoisted(() => ({
  randomUUIDMock: vi.fn()
}))

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock
}))

import { createInMemoryEventStore } from './event-store.js'

afterEach(() => {
  randomUUIDMock.mockReset()
})

describe('createInMemoryEventStore', () => {
  it('stores event ids and exposes their stream ownership', async () => {
    randomUUIDMock.mockReturnValueOnce('001')

    const store = createInMemoryEventStore()
    const message = jsonRpcMessage('stored')
    const eventId = await store.storeEvent('stream-a', message)

    await expect(store.getStreamIdForEventId!(eventId)).resolves.toBe(
      'stream-a'
    )
    await expect(
      store.getStreamIdForEventId!('missing')
    ).resolves.toBeUndefined()
  })

  it('returns an empty stream id when replay starts from an unknown event', async () => {
    const store = createInMemoryEventStore()
    const send = vi.fn<(_: string, __: JSONRPCMessage) => Promise<void>>()

    await expect(store.replayEventsAfter('missing', { send })).resolves.toBe('')
    expect(send).not.toHaveBeenCalled()
  })

  it('replays only later events from the same stream in sorted event order', async () => {
    randomUUIDMock
      .mockReturnValueOnce('002')
      .mockReturnValueOnce('001')
      .mockReturnValueOnce('003')
      .mockReturnValueOnce('004')

    const store = createInMemoryEventStore()
    const first = await store.storeEvent('stream-a', jsonRpcMessage('first'))
    await store.storeEvent('stream-b', jsonRpcMessage('other-stream'))
    await store.storeEvent('stream-a', jsonRpcMessage('second'))
    await store.storeEvent('stream-a', jsonRpcMessage('third'))
    const send = vi.fn<(_: string, __: JSONRPCMessage) => Promise<void>>()

    await expect(store.replayEventsAfter(first, { send })).resolves.toBe(
      'stream-a'
    )
    expect(send.mock.calls).toEqual([
      ['stream-a_003', jsonRpcMessage('second')],
      ['stream-a_004', jsonRpcMessage('third')]
    ])
  })

  it('returns the stream id without sending when there are no later events', async () => {
    randomUUIDMock.mockReturnValueOnce('001')

    const store = createInMemoryEventStore()
    const last = await store.storeEvent('stream-a', jsonRpcMessage('only'))
    const send = vi.fn<(_: string, __: JSONRPCMessage) => Promise<void>>()

    await expect(store.replayEventsAfter(last, { send })).resolves.toBe(
      'stream-a'
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('ignores same-stream events that sort before the replay anchor', async () => {
    randomUUIDMock.mockReturnValueOnce('003').mockReturnValueOnce('001')

    const store = createInMemoryEventStore()
    const anchor = await store.storeEvent('stream-a', jsonRpcMessage('anchor'))
    await store.storeEvent('stream-a', jsonRpcMessage('earlier'))
    const send = vi.fn<(_: string, __: JSONRPCMessage) => Promise<void>>()

    await expect(store.replayEventsAfter(anchor, { send })).resolves.toBe(
      'stream-a'
    )
    expect(send).not.toHaveBeenCalled()
  })
})

function jsonRpcMessage(method: string): JSONRPCMessage {
  return {
    jsonrpc: '2.0',
    method,
    params: { value: method }
  }
}
