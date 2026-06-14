import type {
  PostgresLikeClient,
  PostgresQueryResult
} from '../runtime/postgres-store-client.js'
import { postgresJobStatements } from '../jobs-postgres.js'
import { postgresPolicyStatements } from '../runtime/postgres-policy-stores.js'

type JobState = {
  job_id: string
  operation: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  input_json: string
  result_json: string | null
  error_json: string | null
  poll_after_ms: number
  expires_at: number
  cancel_requested: boolean
  created_at: number
  updated_at: number
  started_at: number | null
  completed_at: number | null
  lease_owner: string | null
  lease_expires_at: number | null
}

type AuditRow = {
  correlation_id: string
  outcome: 'success' | 'error' | 'denied'
  subject: string | null
  tenant_id: string | null
  tool: string
}

type IdempotencyState =
  | {
      status: 'in_progress'
      owner: string
      token: string
      expires_at: number
    }
  | {
      status: 'completed'
      result_json: string
      expires_at: number
    }

export class FakePostgresClient implements PostgresLikeClient {
  readonly #jobs = new Map<string, JobState>()
  readonly #audit: AuditRow[] = []
  readonly #idempotency = new Map<string, IdempotencyState>()

  query<Row extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): PostgresQueryResult<Row> {
    if (sql.startsWith(postgresJobStatements.JOB_CREATE_SQL)) {
      const job = jobStateFromParams(params)
      this.#jobs.set(job.job_id, job)
      return emptyResult()
    }
    if (sql.startsWith(postgresJobStatements.JOB_GET_SQL)) {
      const row = this.#jobs.get(String(params[0] ?? ''))
      return row === undefined
        ? emptyResult()
        : { rowCount: 1, rows: [clone(row) as unknown as Row] }
    }
    if (sql.startsWith(postgresJobStatements.JOB_SAVE_SQL)) {
      const job = jobStateFromParams(params)
      this.#jobs.set(job.job_id, job)
      return emptyResult()
    }
    if (sql.startsWith(postgresJobStatements.JOB_CLAIM_NEXT_SQL)) {
      const operation = String(params[0] ?? '')
      const now = Number(params[1] ?? 0)
      const workerId = String(params[2] ?? '')
      const leaseExpiresAt = Number(params[3] ?? 0)
      const candidate = [...this.#jobs.values()]
        .filter((job) => job.operation === operation)
        .filter((job) => job.expires_at > now)
        .filter((job) => {
          if (job.status === 'queued') return true
          return (
            job.status === 'running' &&
            (job.lease_expires_at === null || job.lease_expires_at <= now)
          )
        })
        .sort((left, right) => left.created_at - right.created_at)[0]
      if (candidate === undefined) return emptyResult()
      const claimed: JobState = {
        ...candidate,
        status: 'running',
        started_at: candidate.started_at ?? now,
        updated_at: now,
        lease_owner: workerId,
        lease_expires_at: leaseExpiresAt
      }
      this.#jobs.set(claimed.job_id, claimed)
      return { rowCount: 1, rows: [clone(claimed) as unknown as Row] }
    }
    if (sql.startsWith(postgresPolicyStatements.AUDIT_INSERT_SQL)) {
      this.#audit.push({
        correlation_id: String(params[0] ?? ''),
        outcome: String(params[1] ?? '') as AuditRow['outcome'],
        subject: nullableString(params[2]),
        tenant_id: nullableString(params[3]),
        tool: String(params[4] ?? '')
      })
      return emptyResult()
    }
    if (sql.startsWith(postgresPolicyStatements.IDEMPOTENCY_BEGIN_SQL)) {
      const key = String(params[0] ?? '')
      const owner = String(params[1] ?? '')
      const token = String(params[2] ?? '')
      const expiresAt = Number(params[3] ?? 0)
      const now = Number(params[4] ?? 0)
      const current = this.#idempotency.get(key)
      if (current === undefined || current.expires_at <= now) {
        this.#idempotency.set(key, {
          status: 'in_progress',
          owner,
          token,
          expires_at: expiresAt
        })
        return {
          rowCount: 1,
          rows: [
            {
              outcome: 'acquired',
              token,
              result_json: null,
              retry_after_ms: null
            } as unknown as Row
          ]
        }
      }
      if (current.status === 'completed') {
        return {
          rowCount: 1,
          rows: [
            {
              outcome: 'replay',
              token: null,
              result_json: current.result_json,
              retry_after_ms: null
            } as unknown as Row
          ]
        }
      }
      return {
        rowCount: 1,
        rows: [
        {
          outcome: 'in_progress',
          token: current.token,
          result_json: null,
          retry_after_ms: Math.max(0, current.expires_at - now)
        } as unknown as Row
      ]
    }
  }
    if (sql.startsWith(postgresPolicyStatements.IDEMPOTENCY_COMPLETE_SQL)) {
      const key = String(params[0] ?? '')
      const token = String(params[1] ?? '')
      const resultJson = String(params[2] ?? '')
      const expiresAt = Number(params[3] ?? 0)
      const current = this.#idempotency.get(key)
      if (
        current !== undefined &&
        current.status === 'in_progress' &&
        current.token === token
      ) {
        this.#idempotency.set(key, {
          status: 'completed',
          result_json: resultJson,
          expires_at: expiresAt
        })
      }
      return emptyResult()
    }
    if (sql.startsWith(postgresPolicyStatements.IDEMPOTENCY_ABANDON_SQL)) {
      const key = String(params[0] ?? '')
      const token = String(params[1] ?? '')
      const current = this.#idempotency.get(key)
      if (
        current !== undefined &&
        current.status === 'in_progress' &&
        current.token === token
      ) {
        this.#idempotency.delete(key)
      }
      return emptyResult()
    }
    throw new Error(`Unsupported Postgres query: ${sql}`)
  }

  auditRows(): readonly AuditRow[] {
    return this.#audit.map((row) => ({ ...row }))
  }
}

function emptyResult<Row extends Record<string, unknown>>(): PostgresQueryResult<Row> {
  return { rowCount: 0, rows: [] }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function jobStateFromParams(params: readonly unknown[]): JobState {
  return {
    job_id: String(params[0] ?? ''),
    operation: String(params[1] ?? ''),
    status: String(params[2] ?? '') as JobState['status'],
    input_json: String(params[3] ?? 'null'),
    result_json: nullableString(params[4]),
    error_json: nullableString(params[5]),
    poll_after_ms: Number(params[6] ?? 0),
    expires_at: Number(params[7] ?? 0),
    cancel_requested: Boolean(params[8]),
    created_at: Number(params[9] ?? 0),
    updated_at: Number(params[10] ?? 0),
    started_at:
      params[11] === null || params[11] === undefined ? null : Number(params[11]),
    completed_at:
      params[12] === null || params[12] === undefined ? null : Number(params[12]),
    lease_owner: nullableString(params[13]),
    lease_expires_at:
      params[14] === null || params[14] === undefined ? null : Number(params[14])
  }
}
