import { afterEach, describe, expect, it } from 'vitest'

import {
  createRedisConcurrencyStore,
  createRedisIdempotencyStore,
  createRedisJobQueue,
  createRedisRateLimitStore
} from './index.js'
import { FakeRedisClient } from './testing/fake-redis-client.js'

describe('redis reference adapters', () => {
  afterEach(() => {})

  it('shares rate limit counters across adapter instances', async () => {
    const client = new FakeRedisClient()
    const first = createRedisRateLimitStore(client)
    const second = createRedisRateLimitStore(client)
    const nowMs = Date.now()

    await expect(
      first.checkRateLimit({
        key: 'tenant-a:tool',
        maxCalls: 1,
        nowMs,
        windowMs: 1_000
      })
    ).resolves.toEqual({ allowed: true })
    await expect(
      second.checkRateLimit({
        key: 'tenant-a:tool',
        maxCalls: 1,
        nowMs: nowMs + 100,
        windowMs: 1_000
      })
    ).resolves.toEqual({ allowed: false, retryAfterMs: 900 })
  })

  it('shares concurrency permits across adapter instances and respects lease expiry', async () => {
    const client = new FakeRedisClient()
    const first = createRedisConcurrencyStore(client)
    const second = createRedisConcurrencyStore(client)

    const permit = await first.acquireConcurrency({
      key: 'sync-payments',
      limit: 1,
      leaseMs: 50,
      nowMs: 10,
      owner: 'req-1'
    })
    expect(permit?.token).toBeTruthy()
    await expect(
      second.acquireConcurrency({
        key: 'sync-payments',
        limit: 1,
        leaseMs: 50,
        nowMs: 20,
        owner: 'req-2'
      })
    ).resolves.toBeUndefined()

    await expect(
      second.acquireConcurrency({
        key: 'sync-payments',
        limit: 1,
        leaseMs: 50,
        nowMs: 61,
        owner: 'req-3'
      })
    ).resolves.toMatchObject({ token: expect.any(String) })
  })

  it('shares idempotency state across adapter instances', async () => {
    const client = new FakeRedisClient()
    const first = createRedisIdempotencyStore(client)
    const second = createRedisIdempotencyStore(client)
    const nowMs = Date.now()

    const acquired = await first.beginIdempotentRequest({
      key: 'create-payment:alice:tenant-a:default-client:req-1',
      nowMs,
      owner: 'req-1',
      ttlMs: 1_000
    })
    expect(acquired).toMatchObject({
      kind: 'acquired',
      token: expect.any(String)
    })
    await expect(
      second.beginIdempotentRequest({
        key: 'create-payment:alice:tenant-a:default-client:req-1',
        nowMs: nowMs + 50,
        owner: 'req-2',
        ttlMs: 1_000
      })
    ).resolves.toEqual({
      kind: 'in_progress',
      retryAfterMs: 950
    })

    await first.completeIdempotentRequest({
      key: 'create-payment:alice:tenant-a:default-client:req-1',
      token: acquired.kind === 'acquired' ? acquired.token : '',
      nowMs: nowMs + 100,
      ttlMs: 1_000,
      result: {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { paymentId: 'payment-1' }
      }
    })

    await expect(
      second.beginIdempotentRequest({
        key: 'create-payment:alice:tenant-a:default-client:req-1',
        nowMs: nowMs + 150,
        owner: 'req-3',
        ttlMs: 1_000
      })
    ).resolves.toMatchObject({
      kind: 'replay',
      result: {
        structuredContent: { paymentId: 'payment-1' }
      }
    })
  })

  it('wakes workers through the shared redis job queue', async () => {
    const client = new FakeRedisClient()
    const publisher = createRedisJobQueue(client)
    const workerQueue = createRedisJobQueue(client)
    const signal = new AbortController()
    const waiting = workerQueue.wait({
      signal: signal.signal,
      timeoutMs: 1_000
    })

    await publisher.notify('job-1')

    await expect(waiting).resolves.toBeUndefined()
  })
})
