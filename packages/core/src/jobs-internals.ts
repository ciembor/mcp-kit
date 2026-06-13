import { McpKitError } from './definitions/error.js'
import type {
  AsyncJobExecution,
  JobFailure,
  JobRecord,
  JobSnapshot,
  JobStatus,
  JobStore
} from './jobs.js'

export async function runNextJob<Input, Output>(args: {
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
  if (claimed.cancelRequested) return cancelClaimedJob(args, claimed)

  try {
    const result = await executeClaimedJob(args, claimed)
    return completeClaimedJob(args, claimed.jobId, result)
  } catch (error) {
    if (args.signal.aborted) throw error
    return failClaimedJob(args, claimed.jobId, error)
  }
}

export async function requireJob<Input, Output>(
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

export function snapshot<Output>(
  job: JobSnapshot<Output>
): JobSnapshot<Output> {
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

export function isTerminal(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export function cancelledQueuedJob<Input, Output>(
  job: JobRecord<Input, Output>,
  timestamp: number
): JobRecord<Input, Output> {
  return {
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
}

export function requestedCancellation<Input, Output>(
  job: JobRecord<Input, Output>,
  timestamp: number
): JobRecord<Input, Output> {
  return {
    ...job,
    cancelRequested: true,
    updatedAt: timestamp
  }
}

async function cancelClaimedJob<Input, Output>(
  args: {
    now: () => number
    jobStore: JobStore<Input, Output>
  },
  claimed: JobRecord<Input, Output>
): Promise<JobSnapshot<Output>> {
  const cancelled = terminalJob(claimed, 'cancelled', args.now(), {
    code: 'JOB_CANCELLED',
    message: 'Job was cancelled before completion.'
  })
  await args.jobStore.save(cancelled)
  return snapshot(cancelled)
}

async function executeClaimedJob<Input, Output>(
  args: {
    execute: AsyncJobExecution<Input, Output>
    signal: AbortSignal
  },
  claimed: JobRecord<Input, Output>
): Promise<Output> {
  return args.execute({
    job: snapshot(claimed),
    input: claimed.input,
    signal: args.signal
  })
}

async function completeClaimedJob<Input, Output>(
  args: {
    now: () => number
    jobStore: JobStore<Input, Output>
  },
  jobId: string,
  result: Output
): Promise<JobSnapshot<Output>> {
  const latest = await requireJob(args.jobStore, jobId)
  if (latest.cancelRequested) return cancelClaimedJob(args, latest)

  const timestamp = args.now()
  const succeeded: JobRecord<Input, Output> = {
    ...withoutRuntimeFields(latest),
    status: 'succeeded',
    result,
    completedAt: timestamp,
    updatedAt: timestamp
  }
  await args.jobStore.save(succeeded)
  return snapshot(succeeded)
}

async function failClaimedJob<Input, Output>(
  args: {
    now: () => number
    jobStore: JobStore<Input, Output>
  },
  jobId: string,
  error: unknown
): Promise<JobSnapshot<Output>> {
  const latest = await requireJob(args.jobStore, jobId)
  const failed = terminalJob(latest, 'failed', args.now(), {
    code: 'JOB_FAILED',
    message: error instanceof Error ? error.message : 'Job execution failed.'
  })
  await args.jobStore.save(failed)
  return snapshot(failed)
}
