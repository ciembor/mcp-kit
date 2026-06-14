import { defineStoreAdapterMetadata } from './store-adapter-metadata.js'
import type { JobQueue, JobRecord, JobStore } from './jobs-contracts.js'

export function createInMemoryJobStore<
  Input = unknown,
  Output = unknown
>(): JobStore<Input, Output> {
  const jobs = new Map<string, JobRecord<Input, Output>>()

  return defineStoreAdapterMetadata(
    {
      async create(job) {
        jobs.set(job.jobId, { ...job })
      },
      async get(jobId) {
        const job = jobs.get(jobId)
        return job === undefined ? undefined : { ...job }
      },
      async save(job) {
        jobs.set(job.jobId, { ...job })
      },
      async claimNext({ operation, workerId, now, leaseMs }) {
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
        if (candidate === undefined) return undefined

        const claimed: JobRecord<Input, Output> = {
          ...candidate,
          status: 'running',
          startedAt: candidate.startedAt ?? now,
          updatedAt: now,
          leaseOwner: workerId,
          leaseExpiresAt: now + leaseMs
        }
        jobs.set(claimed.jobId, { ...claimed })
        return { ...claimed }
      }
    },
    {
      adapter: 'InMemoryJobStore',
      support: 'development-and-test'
    }
  )
}

export function createInMemoryJobQueue(): JobQueue {
  let listeners: Array<() => void> = []

  return defineStoreAdapterMetadata(
    {
      async notify() {
        const current = listeners
        listeners = []
        for (const listener of current) listener()
      },
      wait({ signal, timeoutMs }) {
        if (signal.aborted) {
          return Promise.reject(queueAbortError(signal))
        }
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup()
            resolve()
          }, timeoutMs)
          const onAbort = () => {
            cleanup()
            reject(queueAbortError(signal))
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
    },
    {
      adapter: 'InMemoryJobQueue',
      support: 'development-and-test'
    }
  )
}

function queueAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Queue wait aborted')
}
