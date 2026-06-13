import { McpKitError } from './definitions/error.js'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type JobFailure = {
  code: string
  message: string
}

export type JobSnapshot<Output = unknown> = {
  jobId: string
  operation: string
  status: JobStatus
  pollAfterMs: number
  expiresAt: number
  cancelRequested: boolean
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  result?: Output
  error?: JobFailure
}

export type JobRecord<Input = unknown, Output = unknown> = JobSnapshot<Output> & {
  input: Input
  leaseOwner?: string
  leaseExpiresAt?: number
}

export type JobStore<Input = unknown, Output = unknown> = {
  create(job: JobRecord<Input, Output>): Promise<void>
  get(jobId: string): Promise<JobRecord<Input, Output> | undefined>
  save(job: JobRecord<Input, Output>): Promise<void>
  claimNext(args: {
    operation: string
    workerId: string
    now: number
    leaseMs: number
  }): Promise<JobRecord<Input, Output> | undefined>
}

export type JobQueue = {
  notify(jobId: string): Promise<void>
  wait(args: { signal: AbortSignal; timeoutMs: number }): Promise<void>
}

export type JobTaskView = {
  id: string
  status: JobStatus
  cancelRequested: boolean
  pollAfterMs: number
  expiresAt: number
  resultAvailable: boolean
}

export type JobTaskAdapter<Task> = {
  adapt(job: JobTaskView): Task
}

export type AsyncJobExecution<Input, Output> = (args: {
  job: JobSnapshot<Output>
  input: Input
  signal: AbortSignal
}) => Promise<Output>

export type AsyncJobWorker<Output> = {
  runNext(signal?: AbortSignal): Promise<JobSnapshot<Output> | undefined>
  runUntilIdle(args?: {
    signal?: AbortSignal
    maxJobs?: number
  }): Promise<readonly JobSnapshot<Output>[]>
  waitForWork(signal: AbortSignal): Promise<void>
}

export function createAsyncJobOperation<Input, Output>(options: {
  operation: string
  jobStore: JobStore<Input, Output>
  jobQueue: JobQueue
  execute: AsyncJobExecution<Input, Output>
  ttlMs: number
  pollAfterMs: number
  leaseMs?: number
  idleWaitMs?: number
  now?: () => number
  idFactory?: () => string
}) {
  assertPositiveInteger(options.operation, 'ttlMs', options.ttlMs)
  assertPositiveInteger(
    options.operation,
    'pollAfterMs',
    options.pollAfterMs
  )
  const leaseMs = options.leaseMs ?? 30_000
  const idleWaitMs = options.idleWaitMs ?? 1_000
  assertPositiveInteger(options.operation, 'leaseMs', leaseMs)
  assertPositiveInteger(options.operation, 'idleWaitMs', idleWaitMs)
  const now = options.now ?? (() => Date.now())
  const idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID())

  return {
    async start(input: Input): Promise<JobSnapshot<Output>> {
      const timestamp = now()
      const job: JobRecord<Input, Output> = {
        jobId: idFactory(),
        operation: options.operation,
        status: 'queued',
        input,
        pollAfterMs: options.pollAfterMs,
        expiresAt: timestamp + options.ttlMs,
        cancelRequested: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      await options.jobStore.create(job)
      await options.jobQueue.notify(job.jobId)
      return snapshot(job)
    },

    async status(jobId: string): Promise<JobSnapshot<Output>> {
      return snapshot(await requireJob(options.jobStore, jobId))
    },

    async result(jobId: string): Promise<JobSnapshot<Output>> {
      return snapshot(await requireJob(options.jobStore, jobId))
    },

    async cancel(jobId: string): Promise<JobSnapshot<Output>> {
      const job = await requireJob(options.jobStore, jobId)
      if (isTerminal(job.status)) return snapshot(job)

      const timestamp = now()
      if (job.status === 'queued') {
        const cancelled: JobRecord<Input, Output> = {
          ...job,
          status: 'cancelled',
          cancelRequested: true,
          completedAt: timestamp,
          updatedAt: timestamp,
          error: {
            code: 'JOB_CANCELLED',
            message: 'Job was cancelled before execution.'
          }
        }
        await options.jobStore.save(cancelled)
        return snapshot(cancelled)
      }

      const requested: JobRecord<Input, Output> = {
        ...job,
        cancelRequested: true,
        updatedAt: timestamp
      }
      await options.jobStore.save(requested)
      await options.jobQueue.notify(jobId)
      return snapshot(requested)
    },

    worker(workerId: string): AsyncJobWorker<Output> {
      return {
        runNext: (signal = new AbortController().signal) =>
          runNextJob({
            operation: options.operation,
            workerId,
            signal,
            leaseMs,
            now,
            jobStore: options.jobStore,
            execute: options.execute
          }),
        async runUntilIdle(args = {}) {
          const completed: JobSnapshot<Output>[] = []
          const maxJobs = args.maxJobs ?? Number.POSITIVE_INFINITY
          while (completed.length < maxJobs) {
            const next = await runNextJob({
              operation: options.operation,
              workerId,
              signal: args.signal ?? new AbortController().signal,
              leaseMs,
              now,
              jobStore: options.jobStore,
              execute: options.execute
            })
            if (next === undefined) return completed
            completed.push(next)
          }
          return completed
        },
        waitForWork(signal: AbortSignal) {
          return options.jobQueue.wait({ signal, timeoutMs: idleWaitMs })
        }
      }
    },

    toTask<Task>(
      job: JobSnapshot<Output>,
      adapter: JobTaskAdapter<Task>
    ): Task {
      return adapter.adapt({
        id: job.jobId,
        status: job.status,
        cancelRequested: job.cancelRequested,
        pollAfterMs: job.pollAfterMs,
        expiresAt: job.expiresAt,
        resultAvailable: job.result !== undefined || job.error !== undefined
      })
    }
  }
}

async function runNextJob<Input, Output>(args: {
  operation: string
  workerId: string
  signal: AbortSignal
  leaseMs: number
  now: () => number
  jobStore: JobStore<Input, Output>
  execute: AsyncJobExecution<Input, Output>
}): Promise<JobSnapshot<Output> | undefined> {
  const claimed = await args.jobStore.claimNext({
    operation: args.operation,
    workerId: args.workerId,
    now: args.now(),
    leaseMs: args.leaseMs
  })
  if (claimed === undefined) return undefined

  if (claimed.cancelRequested) {
    const cancelled = terminalJob(claimed, 'cancelled', args.now(), {
      code: 'JOB_CANCELLED',
      message: 'Job was cancelled before completion.'
    })
    await args.jobStore.save(cancelled)
    return snapshot(cancelled)
  }

  try {
    const result = await args.execute({
      job: snapshot(claimed),
      input: claimed.input,
      signal: args.signal
    })

    const latest = await requireJob(args.jobStore, claimed.jobId)
    if (latest.cancelRequested) {
      const cancelled = terminalJob(latest, 'cancelled', args.now(), {
        code: 'JOB_CANCELLED',
        message: 'Job was cancelled before completion.'
      })
      await args.jobStore.save(cancelled)
      return snapshot(cancelled)
    }

    const succeeded: JobRecord<Input, Output> = {
      ...withoutRuntimeFields(latest),
      status: 'succeeded',
      result,
      completedAt: args.now(),
      updatedAt: args.now()
    }
    await args.jobStore.save(succeeded)
    return snapshot(succeeded)
  } catch (error) {
    if (args.signal.aborted) {
      throw error
    }

    const latest = await requireJob(args.jobStore, claimed.jobId)
    const failed = terminalJob(latest, 'failed', args.now(), {
      code: 'JOB_FAILED',
      message: error instanceof Error ? error.message : 'Job execution failed.'
    })
    await args.jobStore.save(failed)
    return snapshot(failed)
  }
}

async function requireJob<Input, Output>(
  store: JobStore<Input, Output>,
  jobId: string
): Promise<JobRecord<Input, Output>> {
  const job = await store.get(jobId)
  if (job !== undefined) return job
  throw new McpKitError({
    code: 'JOB_NOT_FOUND',
    message: `Job ${jobId} was not found`,
    safeMessage: 'Job not found.'
  })
}

function terminalJob<Input, Output>(
  job: JobRecord<Input, Output>,
  status: Extract<JobStatus, 'failed' | 'cancelled'>,
  timestamp: number,
  error: JobFailure
): JobRecord<Input, Output> {
  return {
    ...withoutRuntimeFields(job),
    status,
    error,
    completedAt: timestamp,
    updatedAt: timestamp
  }
}

function snapshot<Output>(job: JobSnapshot<Output>): JobSnapshot<Output> {
  return { ...job }
}

function withoutRuntimeFields<Input, Output>(
  job: JobRecord<Input, Output>
): JobRecord<Input, Output> {
  const rest = { ...job }
  delete rest.leaseOwner
  delete rest.leaseExpiresAt
  delete rest.error
  delete rest.result
  return { ...rest }
}

function isTerminal(status: JobStatus): boolean {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled'
  )
}

function assertPositiveInteger(
  operation: string,
  field: string,
  value: number
): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Async job operation "${operation}" ${field} must be a positive integer`
    )
  }
}
