import { describe, expect, it, vi } from 'vitest'

import {
  createAsyncJobOperation,
  type JobQueue,
  type JobRecord,
  type JobStore
} from './jobs.js'
import { requireJob, runNextJob } from './jobs-internals.js'

describe('async jobs branch coverage', () => {
  it('validates positive integer configuration fields', () => {
    expect(() =>
      createAsyncJobOperation({
        operation: 'bad-ttl',
        jobStore: createStore(),
        jobQueue: createQueue(),
        execute: () => Promise.resolve({ ok: true }),
        ttlMs: 0,
        pollAfterMs: 1
      })
    ).toThrow('Async job operation "bad-ttl" ttlMs must be a positive integer')

    expect(() =>
      createAsyncJobOperation({
        operation: 'bad-poll',
        jobStore: createStore(),
        jobQueue: createQueue(),
        execute: () => Promise.resolve({ ok: true }),
        ttlMs: 1,
        pollAfterMs: 0
      })
    ).toThrow(
      'Async job operation "bad-poll" pollAfterMs must be a positive integer'
    )

    expect(() =>
      createAsyncJobOperation({
        operation: 'bad-lease',
        jobStore: createStore(),
        jobQueue: createQueue(),
        execute: () => Promise.resolve({ ok: true }),
        ttlMs: 1,
        pollAfterMs: 1,
        leaseMs: 0
      })
    ).toThrow(
      'Async job operation "bad-lease" leaseMs must be a positive integer'
    )

    expect(() =>
      createAsyncJobOperation({
        operation: 'bad-idle',
        jobStore: createStore(),
        jobQueue: createQueue(),
        execute: () => Promise.resolve({ ok: true }),
        ttlMs: 1,
        pollAfterMs: 1,
        idleWaitMs: 0
      })
    ).toThrow(
      'Async job operation "bad-idle" idleWaitMs must be a positive integer'
    )
  })

  it('raises not found snapshots through the public API', async () => {
    const operation = createAsyncJobOperation({
      operation: 'lookup',
      jobStore: createStore(),
      jobQueue: createQueue(),
      execute: () => Promise.resolve({ ok: true }),
      ttlMs: 1,
      pollAfterMs: 1
    })

    await expect(operation.status('missing')).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND'
    })
    await expect(requireJob(createStore(), 'missing')).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND'
    })
  })

  it('cancels claimed jobs before execution and after completion races', async () => {
    const beforeExecuteStore = createStore<string, string>({
      'job-1': {
        jobId: 'job-1',
        operation: 'mail',
        status: 'running',
        input: 'hello',
        pollAfterMs: 100,
        expiresAt: 1_000,
        cancelRequested: true,
        createdAt: 1,
        updatedAt: 2
      }
    })

    await expect(
      runNextJob({
        operation: 'mail',
        workerId: 'worker-a',
        signal: new AbortController().signal,
        leaseMs: 100,
        now: () => 10,
        jobStore: beforeExecuteStore,
        execute: () => Promise.resolve('sent')
      })
    ).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'JOB_CANCELLED' }
    })

    const completionRaceStore = createStore<string, string>({
      'job-2': {
        jobId: 'job-2',
        operation: 'mail',
        status: 'queued',
        input: 'hello',
        pollAfterMs: 100,
        expiresAt: 1_000,
        cancelRequested: false,
        createdAt: 1,
        updatedAt: 1
      }
    })
    await expect(
      runNextJob({
        operation: 'mail',
        workerId: 'worker-b',
        signal: new AbortController().signal,
        leaseMs: 100,
        now: () => 20,
        jobStore: completionRaceStore,
        execute: async ({ job }) => {
          await completionRaceStore.save({
            ...job,
            input: 'hello',
            status: 'running',
            cancelRequested: true
          })
          return 'sent'
        }
      })
    ).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'JOB_CANCELLED' }
    })
  })

  it('records failed jobs unless the worker was aborted', async () => {
    const store = createStore<string, string>({
      'job-3': {
        jobId: 'job-3',
        operation: 'mail',
        status: 'queued',
        input: 'hello',
        pollAfterMs: 100,
        expiresAt: 1_000,
        cancelRequested: false,
        createdAt: 1,
        updatedAt: 1
      }
    })

    await expect(
      runNextJob({
        operation: 'mail',
        workerId: 'worker-c',
        signal: new AbortController().signal,
        leaseMs: 100,
        now: () => 30,
        jobStore: store,
        execute: () => {
          throw new Error('boom')
        }
      })
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'JOB_FAILED', message: 'boom' }
    })

    await expect(
      runNextJob({
        operation: 'mail',
        workerId: 'worker-text',
        signal: new AbortController().signal,
        leaseMs: 100,
        now: () => 31,
        jobStore: createStore({
          'job-text': {
            jobId: 'job-text',
            operation: 'mail',
            status: 'queued',
            input: 'hello',
            pollAfterMs: 100,
            expiresAt: 1_000,
            cancelRequested: false,
            createdAt: 1,
            updatedAt: 1
          }
        }),
        execute: () => rejectWith('boom')
      })
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'JOB_FAILED', message: 'Job execution failed.' }
    })

    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(
      runNextJob({
        operation: 'mail',
        workerId: 'worker-d',
        signal: controller.signal,
        leaseMs: 100,
        now: () => 40,
        jobStore: createStore({
          'job-4': {
            jobId: 'job-4',
            operation: 'mail',
            status: 'queued',
            input: 'hello',
            pollAfterMs: 100,
            expiresAt: 1_000,
            cancelRequested: false,
            createdAt: 1,
            updatedAt: 1
          }
        }),
        execute: () => {
          throw new Error('stopped')
        }
      })
    ).rejects.toThrow('stopped')
  })

  it('waits for work and stops runUntilIdle at maxJobs', async () => {
    const wait = vi.fn<JobQueue['wait']>(() => Promise.resolve())
    const queue: JobQueue = {
      notify: () => Promise.resolve(),
      wait
    }
    const store = createStore<number, number>({
      'job-5': {
        jobId: 'job-5',
        operation: 'double',
        status: 'queued',
        input: 2,
        pollAfterMs: 25,
        expiresAt: 1_000,
        cancelRequested: false,
        createdAt: 1,
        updatedAt: 1
      },
      'job-6': {
        jobId: 'job-6',
        operation: 'double',
        status: 'queued',
        input: 3,
        pollAfterMs: 25,
        expiresAt: 1_000,
        cancelRequested: false,
        createdAt: 2,
        updatedAt: 2
      }
    })
    const operation = createAsyncJobOperation({
      operation: 'double',
      jobStore: store,
      jobQueue: queue,
      execute: ({ input }) => Promise.resolve(input * 2),
      ttlMs: 100,
      pollAfterMs: 25,
      idleWaitMs: 77,
      now: () => 50
    })

    const worker = operation.worker('worker-z')
    await expect(
      worker.waitForWork(new AbortController().signal)
    ).resolves.toBe(undefined)
    expect(wait).toHaveBeenCalledOnce()
    const waitCall = wait.mock.calls[0]
    expect(waitCall).toBeDefined()
    if (waitCall) {
      const [options] = waitCall
      expect(options.timeoutMs).toBe(77)
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }

    await expect(worker.runUntilIdle({ maxJobs: 1 })).resolves.toMatchObject([
      { jobId: 'job-5', status: 'succeeded', result: 4 }
    ])
  })

  it('marks running jobs for cancellation and uses default id and clock helpers', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123)
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-0000-0000-000000000000'
    )

    const queue = {
      notify: vi.fn(() => Promise.resolve()),
      wait: vi.fn(() => Promise.resolve())
    }
    const store = createStore<number, number>()
    const operation = createAsyncJobOperation({
      operation: 'defaulted',
      jobStore: store,
      jobQueue: queue,
      execute: ({ input }) => Promise.resolve(input * 2),
      ttlMs: 500,
      pollAfterMs: 25
    })

    const started = await operation.start(2)
    await operation.worker('worker-run').runNext()
    const cancelled = await operation.cancel(started.jobId)

    expect(started.jobId).toBe('00000000-0000-0000-0000-000000000000')
    expect(started.createdAt).toBe(123)
    expect(cancelled).toMatchObject({
      status: 'succeeded',
      cancelRequested: false
    })
    expect(queue.notify).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000000'
    )
  })

  it('returns immediately when no jobs are available and notifies on running-job cancellation', async () => {
    const notify = vi.fn(() => Promise.resolve())
    const queue = {
      notify,
      wait: vi.fn(() => Promise.resolve())
    }
    const emptyOperation = createAsyncJobOperation({
      operation: 'defaulted',
      jobStore: createStore<number, number>(),
      jobQueue: queue,
      execute: ({ input }) => Promise.resolve(input * 2),
      ttlMs: 500,
      pollAfterMs: 25,
      now: () => 123
    })

    await expect(
      emptyOperation.worker('worker-empty').runUntilIdle({
        signal: new AbortController().signal,
        maxJobs: 2
      })
    ).resolves.toEqual([])

    const store = createStore<number, number>({
      'job-run': {
        jobId: 'job-run',
        operation: 'defaulted',
        status: 'running',
        input: 2,
        pollAfterMs: 25,
        expiresAt: 500,
        cancelRequested: false,
        createdAt: 1,
        updatedAt: 1
      }
    })
    const operation = createAsyncJobOperation({
      operation: 'defaulted',
      jobStore: store,
      jobQueue: queue,
      execute: ({ input }) => Promise.resolve(input * 2),
      ttlMs: 500,
      pollAfterMs: 25,
      now: () => 123
    })

    await expect(operation.cancel('job-run')).resolves.toMatchObject({
      status: 'running',
      cancelRequested: true,
      updatedAt: 123
    })
    expect(notify).toHaveBeenCalledWith('job-run')
    await expect(
      emptyOperation.worker('worker-empty-2').runUntilIdle()
    ).resolves.toEqual([])
  })
})

function createStore<Input, Output>(
  seed: Record<string, JobRecord<Input, Output>> = {}
): JobStore<Input, Output> {
  const jobs = new Map(
    Object.entries(seed).map(([jobId, job]) => [jobId, { ...job }])
  )
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

function createQueue(): JobQueue {
  return {
    notify: () => Promise.resolve(),
    wait: () => Promise.resolve()
  }
}

function rejectWith(reason: unknown): Promise<never> {
  return {
    then(_onFulfilled, onRejected) {
      if (onRejected == null) return Promise.resolve(undefined)
      return Promise.resolve(onRejected(reason))
    }
  } as Promise<never>
}
