import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAsyncJobOperation,
  type JobQueue,
  type JobRecord,
  type JobStore
} from './index.js'

describe('async jobs', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs start/status/result/cancel independently from transport concerns', async () => {
    const store = createSharedJobStore<{ value: number }, { doubled: number }>()
    const queue = createWakeQueue()
    const operation = createAsyncJobOperation({
      operation: 'double',
      jobStore: store,
      jobQueue: queue,
      ttlMs: 60_000,
      pollAfterMs: 250,
      execute: ({ input }) => Promise.resolve({ doubled: input.value * 2 }),
      idFactory: () => 'job-1',
      now: () => 1_000
    })

    const started = await operation.start({ value: 21 })
    expect(started).toMatchObject({
      jobId: 'job-1',
      status: 'queued',
      pollAfterMs: 250,
      expiresAt: 61_000
    })

    const worker = operation.worker('worker-a')
    await expect(worker.runNext()).resolves.toMatchObject({
      status: 'succeeded',
      result: { doubled: 42 }
    })
    await expect(operation.status('job-1')).resolves.toMatchObject({
      status: 'succeeded'
    })
    await expect(operation.result('job-1')).resolves.toMatchObject({
      result: { doubled: 42 }
    })

    const cancelled = await operation.cancel('job-1')
    expect(cancelled.status).toBe('succeeded')
  })

  it('reclaims leased work after a worker restart and lets another worker read the result', async () => {
    vi.useFakeTimers()
    const clock = { now: 10_000 }
    const store = createSharedJobStore<{ value: number }, { tripled: number }>()
    const queue = createWakeQueue()
    let releaseFirst = () => {}
    const firstWorkerBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const operation = createAsyncJobOperation({
      operation: 'triple',
      jobStore: store,
      jobQueue: queue,
      ttlMs: 120_000,
      pollAfterMs: 500,
      leaseMs: 5_000,
      now: () => clock.now,
      idFactory: () => 'job-restart',
      execute: async ({ input, signal }) => {
        if (input.value === 7) {
          await Promise.race([
            firstWorkerBlocked,
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () =>
                  reject(
                    signal.reason instanceof Error
                      ? signal.reason
                      : new Error('Job execution aborted')
                  ),
                { once: true }
              )
            })
          ])
        }
        return { tripled: input.value * 3 }
      }
    })

    const started = await operation.start({ value: 7 })
    const firstSignal = new AbortController()
    const firstRun = operation.worker('worker-a').runNext(firstSignal.signal)
    await vi.waitFor(async () => {
      const current = await operation.status(started.jobId)
      expect(current.status).toBe('running')
    })

    firstSignal.abort(new Error('worker restarted'))
    await expect(firstRun).rejects.toThrow('worker restarted')

    clock.now += 6_000
    releaseFirst()

    const secondResult = await operation.worker('worker-b').runNext()
    expect(secondResult).toMatchObject({
      jobId: 'job-restart',
      status: 'succeeded',
      result: { tripled: 21 }
    })

    await expect(operation.result('job-restart')).resolves.toMatchObject({
      result: { tripled: 21 }
    })
  })

  it('cancels queued work and provides a task adapter view with polling hints', async () => {
    const store = createSharedJobStore<{ name: string }, { ok: true }>()
    const queue = createWakeQueue()
    const operation = createAsyncJobOperation({
      operation: 'hello',
      jobStore: store,
      jobQueue: queue,
      ttlMs: 30_000,
      pollAfterMs: 1_000,
      idFactory: () => 'job-cancel',
      now: () => 5_000,
      execute: () => Promise.resolve({ ok: true })
    })

    const started = await operation.start({ name: 'Ada' })
    const cancelled = await operation.cancel(started.jobId)
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelRequested: true
    })

    const task = operation.toTask(cancelled, {
      adapt(job) {
        return `${job.id}:${job.status}:${job.pollAfterMs}:${job.resultAvailable}`
      }
    })
    expect(task).toBe('job-cancel:cancelled:1000:true')
  })
})

function createSharedJobStore<Input, Output>(): JobStore<Input, Output> {
  const jobs = new Map<string, JobRecord<Input, Output>>()
  return {
    create(job) {
      jobs.set(job.jobId, { ...job })
      return Promise.resolve()
    },
    get(jobId) {
      const job = jobs.get(jobId)
      return Promise.resolve(job === undefined ? undefined : { ...job })
    },
    save(job) {
      jobs.set(job.jobId, { ...job })
      return Promise.resolve()
    },
    claimNext({ operation, workerId, now, leaseMs }) {
      const candidate = [...jobs.values()]
        .filter((job) => job.operation === operation)
        .filter((job) => job.expiresAt > now)
        .filter((job) => {
          if (job.status === 'queued') return true
          return (
            job.status === 'running' &&
            (job.leaseExpiresAt === undefined || job.leaseExpiresAt <= now)
          )
        })
        .sort((left, right) => left.createdAt - right.createdAt)[0]
      if (candidate === undefined) return Promise.resolve(undefined)

      const claimed: JobRecord<Input, Output> = {
        ...candidate,
        status: 'running',
        startedAt: candidate.startedAt ?? now,
        updatedAt: now,
        leaseOwner: workerId,
        leaseExpiresAt: now + leaseMs
      }
      jobs.set(claimed.jobId, { ...claimed })
      return Promise.resolve({ ...claimed })
    }
  }
}

function createWakeQueue(): JobQueue {
  let listeners: Array<() => void> = []
  return {
    notify() {
      const current = listeners
      listeners = []
      for (const listener of current) listener()
      return Promise.resolve()
    },
    wait({ signal, timeoutMs }) {
      if (signal.aborted) {
        return Promise.reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('Queue wait aborted')
        )
      }
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup()
          resolve()
        }, timeoutMs)
        const onAbort = () => {
          cleanup()
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error('Queue wait aborted')
          )
        }
        const onNotify = () => {
          cleanup()
          resolve()
        }
        const cleanup = () => {
          clearTimeout(timeout)
          signal.removeEventListener('abort', onAbort)
          listeners = listeners.filter((listener) => listener !== onNotify)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        listeners.push(onNotify)
      })
    }
  }
}
