import { defineStoreAdapterMetadata } from './store-adapter-metadata.js'
import type { JobFailure, JobRecord, JobStore } from './jobs-contracts.js'
import type { PostgresLikeClient } from './runtime/postgres-store-client.js'

const JOB_CREATE_SQL = '-- mcp-kit:postgres-job-create'
const JOB_GET_SQL = '-- mcp-kit:postgres-job-get'
const JOB_SAVE_SQL = '-- mcp-kit:postgres-job-save'
const JOB_CLAIM_NEXT_SQL = '-- mcp-kit:postgres-job-claim-next'

type JobRow = {
  readonly job_id: string
  readonly operation: string
  readonly status: JobRecord['status']
  readonly input_json: string
  readonly result_json: string | null
  readonly error_json: string | null
  readonly poll_after_ms: number
  readonly expires_at: number
  readonly cancel_requested: boolean
  readonly created_at: number
  readonly updated_at: number
  readonly started_at: number | null
  readonly completed_at: number | null
  readonly lease_owner: string | null
  readonly lease_expires_at: number | null
}

export function createPostgresJobStore<Input = unknown, Output = unknown>(
  client: PostgresLikeClient,
  options: { tableName?: string } = {}
): JobStore<Input, Output> {
  const tableName = options.tableName ?? 'mcp_jobs'
  return defineStoreAdapterMetadata(
    {
      async create(job) {
        await client.query(`${JOB_CREATE_SQL}
insert into ${tableName} (
  job_id,
  operation,
  status,
  input_json,
  result_json,
  error_json,
  poll_after_ms,
  expires_at,
  cancel_requested,
  created_at,
  updated_at,
  started_at,
  completed_at,
  lease_owner,
  lease_expires_at
) values (
  $1, $2, $3, $4, $5, $6,
  $7, $8, $9, $10, $11, $12, $13, $14, $15
)`, jobParams(job))
      },
      async get(jobId) {
        const result = await client.query<JobRow>(`${JOB_GET_SQL}
select
  job_id,
  operation,
  status,
  input_json,
  result_json,
  error_json,
  poll_after_ms,
  expires_at,
  cancel_requested,
  created_at,
  updated_at,
  started_at,
  completed_at,
  lease_owner,
  lease_expires_at
from ${tableName}
where job_id = $1`, [jobId])
        const row = result.rows[0]
        return row === undefined ? undefined : decodeJobRow<Input, Output>(row)
      },
      async save(job) {
        await client.query(`${JOB_SAVE_SQL}
update ${tableName}
set
  operation = $2,
  status = $3,
  input_json = $4,
  result_json = $5,
  error_json = $6,
  poll_after_ms = $7,
  expires_at = $8,
  cancel_requested = $9,
  created_at = $10,
  updated_at = $11,
  started_at = $12,
  completed_at = $13,
  lease_owner = $14,
  lease_expires_at = $15
where job_id = $1`, jobParams(job))
      },
      async claimNext({ operation, workerId, now, leaseMs }) {
        const result = await client.query<JobRow>(`${JOB_CLAIM_NEXT_SQL}
with candidate as (
  select job_id
  from ${tableName}
  where operation = $1
    and expires_at > $2
    and (
      status = 'queued'
      or (
        status = 'running'
        and (
          lease_expires_at is null
          or lease_expires_at <= $2
        )
      )
    )
  order by created_at
  for update skip locked
  limit 1
)
update ${tableName} jobs
set
  status = 'running',
  started_at = coalesce(jobs.started_at, $2),
  updated_at = $2,
  lease_owner = $3,
  lease_expires_at = $4
from candidate
where jobs.job_id = candidate.job_id
returning
  jobs.job_id,
  jobs.operation,
  jobs.status,
  jobs.input_json,
  jobs.result_json,
  jobs.error_json,
  jobs.poll_after_ms,
  jobs.expires_at,
  jobs.cancel_requested,
  jobs.created_at,
  jobs.updated_at,
  jobs.started_at,
  jobs.completed_at,
  jobs.lease_owner,
  jobs.lease_expires_at`, [operation, now, workerId, now + leaseMs])
        const row = result.rows[0]
        return row === undefined ? undefined : decodeJobRow<Input, Output>(row)
      }
    },
    {
      adapter: 'PostgresJobStore',
      support: 'production'
    }
  )
}

export const postgresJobStatements = {
  JOB_CLAIM_NEXT_SQL,
  JOB_CREATE_SQL,
  JOB_GET_SQL,
  JOB_SAVE_SQL
} as const

export const postgresJobSchema = {
  jobStore(options: { tableName?: string } = {}): readonly string[] {
    const tableName = options.tableName ?? 'mcp_jobs'
    return [
      `create table if not exists ${tableName} (
  job_id text primary key,
  operation text not null,
  status text not null,
  input_json text not null,
  result_json text null,
  error_json text null,
  poll_after_ms bigint not null,
  expires_at bigint not null,
  cancel_requested boolean not null,
  created_at bigint not null,
  updated_at bigint not null,
  started_at bigint null,
  completed_at bigint null,
  lease_owner text null,
  lease_expires_at bigint null
)`,
      `create index if not exists ${tableName}_claim_idx on ${tableName} (operation, status, expires_at, created_at)`,
      `create index if not exists ${tableName}_lease_idx on ${tableName} (lease_expires_at)`
    ]
  }
} as const

function jobParams<Input, Output>(
  job: JobRecord<Input, Output>
): readonly unknown[] {
  return [
    job.jobId,
    job.operation,
    job.status,
    JSON.stringify(job.input),
    job.result === undefined ? null : JSON.stringify(job.result),
    job.error === undefined ? null : JSON.stringify(job.error),
    job.pollAfterMs,
    job.expiresAt,
    job.cancelRequested,
    job.createdAt,
    job.updatedAt,
    job.startedAt ?? null,
    job.completedAt ?? null,
    job.leaseOwner ?? null,
    job.leaseExpiresAt ?? null
  ]
}

function decodeJobRow<Input, Output>(row: JobRow): JobRecord<Input, Output> {
  return {
    jobId: row.job_id,
    operation: row.operation,
    status: row.status,
    input: JSON.parse(row.input_json) as Input,
    ...(row.result_json === null
      ? {}
      : { result: JSON.parse(row.result_json) as Output }),
    ...(row.error_json === null
      ? {}
      : { error: JSON.parse(row.error_json) as JobFailure }),
    pollAfterMs: row.poll_after_ms,
    expiresAt: row.expires_at,
    cancelRequested: row.cancel_requested,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: row.lease_expires_at })
  }
}
