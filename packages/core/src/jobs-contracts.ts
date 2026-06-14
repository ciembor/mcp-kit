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
