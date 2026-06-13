import {
  cancelledQueuedJob,
  isTerminal,
  requestedCancellation,
  requireJob,
  runNextJob,
  snapshot
} from './jobs-internals.js'

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

export type JobRecord<
  Input = unknown,
  Output = unknown
> = JobSnapshot<Output> & {
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
  const config = normalizedOptions(options)

  return {
    start: (input: Input) => startJob(options, config, input),
    status: (jobId: string) => loadJobSnapshot(options.jobStore, jobId),
    result: (jobId: string) => loadJobSnapshot(options.jobStore, jobId),
    cancel: (jobId: string) => cancelJob(options, config, jobId),
    worker: (workerId: string) => createWorker(options, config, workerId),
    toTask: <Task>(job: JobSnapshot<Output>, adapter: JobTaskAdapter<Task>) =>
      toTask(adapter, job)
  }
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

function normalizedOptions<Input, Output>(options: {
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
}): {
  leaseMs: number
  idleWaitMs: number
  now: () => number
  idFactory: () => string
} {
  assertPositiveInteger(options.operation, 'ttlMs', options.ttlMs)
  assertPositiveInteger(options.operation, 'pollAfterMs', options.pollAfterMs)
  const leaseMs = options.leaseMs ?? 30_000
  const idleWaitMs = options.idleWaitMs ?? 1_000
  assertPositiveInteger(options.operation, 'leaseMs', leaseMs)
  assertPositiveInteger(options.operation, 'idleWaitMs', idleWaitMs)

  return {
    leaseMs,
    idleWaitMs,
    now: options.now ?? (() => Date.now()),
    idFactory: options.idFactory ?? (() => globalThis.crypto.randomUUID())
  }
}

async function runJobsUntilIdle<Input, Output>(
  options: {
    operation: string
    jobStore: JobStore<Input, Output>
    execute: AsyncJobExecution<Input, Output>
  },
  config: {
    leaseMs: number
    now: () => number
  },
  workerId: string,
  args: {
    signal?: AbortSignal
    maxJobs?: number
  }
): Promise<readonly JobSnapshot<Output>[]> {
  const completed: JobSnapshot<Output>[] = []
  const maxJobs = args.maxJobs ?? Number.POSITIVE_INFINITY
  while (completed.length < maxJobs) {
    const next = await runNextJob({
      operation: options.operation,
      workerId,
      signal: args.signal ?? new AbortController().signal,
      leaseMs: config.leaseMs,
      now: config.now,
      jobStore: options.jobStore,
      execute: options.execute
    })
    if (next === undefined) return completed
    completed.push(next)
  }
  return completed
}

async function startJob<Input, Output>(
  options: {
    operation: string
    jobStore: JobStore<Input, Output>
    jobQueue: JobQueue
    ttlMs: number
    pollAfterMs: number
  },
  config: {
    now: () => number
    idFactory: () => string
  },
  input: Input
): Promise<JobSnapshot<Output>> {
  const timestamp = config.now()
  const job: JobRecord<Input, Output> = {
    jobId: config.idFactory(),
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
}

async function loadJobSnapshot<Input, Output>(
  jobStore: JobStore<Input, Output>,
  jobId: string
): Promise<JobSnapshot<Output>> {
  return snapshot(await requireJob(jobStore, jobId))
}

async function cancelJob<Input, Output>(
  options: {
    jobStore: JobStore<Input, Output>
    jobQueue: JobQueue
  },
  config: {
    now: () => number
  },
  jobId: string
): Promise<JobSnapshot<Output>> {
  const job = await requireJob(options.jobStore, jobId)
  if (isTerminal(job.status)) return snapshot(job)

  const timestamp = config.now()
  const updated =
    job.status === 'queued'
      ? cancelledQueuedJob(job, timestamp)
      : requestedCancellation(job, timestamp)
  await options.jobStore.save(updated)
  if (job.status !== 'queued') await options.jobQueue.notify(jobId)
  return snapshot(updated)
}

function createWorker<Input, Output>(
  options: {
    operation: string
    jobStore: JobStore<Input, Output>
    jobQueue: JobQueue
    execute: AsyncJobExecution<Input, Output>
  },
  config: {
    leaseMs: number
    idleWaitMs: number
    now: () => number
  },
  workerId: string
): AsyncJobWorker<Output> {
  return {
    runNext: (signal = new AbortController().signal) =>
      runNextJob({
        operation: options.operation,
        workerId,
        signal,
        leaseMs: config.leaseMs,
        now: config.now,
        jobStore: options.jobStore,
        execute: options.execute
      }),
    runUntilIdle: (args = {}) =>
      runJobsUntilIdle(options, config, workerId, args),
    waitForWork: (signal) =>
      options.jobQueue.wait({ signal, timeoutMs: config.idleWaitMs })
  }
}

function toTask<Task, Output>(
  adapter: JobTaskAdapter<Task>,
  job: JobSnapshot<Output>
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
