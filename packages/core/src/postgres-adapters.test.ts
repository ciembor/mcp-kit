import { describe, expect, it } from 'vitest'

import {
  createPostgresAuditStore,
  createPostgresIdempotencyStore,
  createPostgresJobStore,
  storeAdapterMetadata
} from './index.js'
import { FakePostgresClient } from './testing/fake-postgres-client.js'

describe('postgres reference adapters', () => {
  it('shares persisted job state across store instances and claims the oldest eligible job', async () => {
    const client = new FakePostgresClient()
    const first = createPostgresJobStore<{ value: number }, { ok: true }>(client)
    const second = createPostgresJobStore<{ value: number }, { ok: true }>(client)

    await first.create({
      jobId: 'job-older',
      operation: 'sync',
      status: 'queued',
      input: { value: 1 },
      pollAfterMs: 100,
      expiresAt: 10_000,
      cancelRequested: false,
      createdAt: 10,
      updatedAt: 10
    })
    await first.create({
      jobId: 'job-newer',
      operation: 'sync',
      status: 'queued',
      input: { value: 2 },
      pollAfterMs: 100,
      expiresAt: 10_000,
      cancelRequested: false,
      createdAt: 20,
      updatedAt: 20
    })

    await expect(
      second.claimNext({
        operation: 'sync',
        workerId: 'worker-a',
        now: 100,
        leaseMs: 500
      })
    ).resolves.toMatchObject({
      jobId: 'job-older',
      status: 'running',
      leaseOwner: 'worker-a',
      leaseExpiresAt: 600
    })

    await expect(first.get('job-older')).resolves.toMatchObject({
      status: 'running',
      leaseOwner: 'worker-a'
    })
  })

  it('persists audit events with production metadata', async () => {
    const client = new FakePostgresClient()
    const store = createPostgresAuditStore(client)

    await store.writeAuditEvent({
      correlationId: 'corr-1',
      outcome: 'denied',
      subject: 'alice',
      tenantId: 'tenant-a',
      tool: 'delete-payment'
    })

    expect(client.auditRows()).toEqual([
      {
        correlation_id: 'corr-1',
        outcome: 'denied',
        subject: 'alice',
        tenant_id: 'tenant-a',
        tool: 'delete-payment'
      }
    ])
    expect(storeAdapterMetadata(store)).toMatchObject({ support: 'production' })
  })

  it('deduplicates idempotent requests across store instances', async () => {
    const client = new FakePostgresClient()
    const first = createPostgresIdempotencyStore(client)
    const second = createPostgresIdempotencyStore(client)

    const acquired = await first.beginIdempotentRequest({
      key: 'tool:alice:tenant-a:client-a:req-1',
      nowMs: 1_000,
      owner: 'req-1',
      ttlMs: 500
    })
    expect(acquired).toMatchObject({
      kind: 'acquired',
      token: expect.any(String)
    })

    await expect(
      second.beginIdempotentRequest({
        key: 'tool:alice:tenant-a:client-a:req-1',
        nowMs: 1_100,
        owner: 'req-2',
        ttlMs: 500
      })
    ).resolves.toEqual({
      kind: 'in_progress',
      retryAfterMs: 400
    })

    await first.completeIdempotentRequest({
      key: 'tool:alice:tenant-a:client-a:req-1',
      token: acquired.kind === 'acquired' ? acquired.token : '',
      nowMs: 1_150,
      ttlMs: 500,
      result: {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { ok: true }
      }
    })

    await expect(
      second.beginIdempotentRequest({
        key: 'tool:alice:tenant-a:client-a:req-1',
        nowMs: 1_200,
        owner: 'req-3',
        ttlMs: 500
      })
    ).resolves.toMatchObject({
      kind: 'replay',
      result: { structuredContent: { ok: true } }
    })
  })
})
