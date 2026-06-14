import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { defineStoreAdapterMetadata } from '../store-adapter-metadata.js'
import type {
  AuditStore,
  IdempotencyBeginResult,
  IdempotencyStore
} from './runtime-store-contracts.js'
import type { PostgresLikeClient } from './postgres-store-client.js'

const AUDIT_INSERT_SQL = '-- mcp-kit:postgres-audit-insert'
const IDEMPOTENCY_BEGIN_SQL = '-- mcp-kit:postgres-idempotency-begin'
const IDEMPOTENCY_COMPLETE_SQL = '-- mcp-kit:postgres-idempotency-complete'
const IDEMPOTENCY_ABANDON_SQL = '-- mcp-kit:postgres-idempotency-abandon'

type IdempotencyRow = {
  readonly outcome: 'acquired' | 'replay' | 'in_progress'
  readonly token: string | null
  readonly result_json: string | null
  readonly retry_after_ms: number | null
}

export function createPostgresAuditStore(
  client: PostgresLikeClient,
  options: { tableName?: string } = {}
): AuditStore {
  const tableName = options.tableName ?? 'mcp_audit_events'
  return defineStoreAdapterMetadata(
    {
      async writeAuditEvent(event) {
        await client.query(
          `${AUDIT_INSERT_SQL}
insert into ${tableName} (
  correlation_id,
  outcome,
  subject,
  tenant_id,
  tool
) values ($1, $2, $3, $4, $5)`,
          [
            event.correlationId,
            event.outcome,
            event.subject ?? null,
            event.tenantId ?? null,
            event.tool
          ]
        )
      }
    },
    {
      adapter: 'PostgresAuditStore',
      support: 'production'
    }
  )
}

export function createPostgresIdempotencyStore(
  client: PostgresLikeClient,
  options: { tableName?: string } = {}
): IdempotencyStore {
  const tableName = options.tableName ?? 'mcp_idempotency_keys'
  return defineStoreAdapterMetadata(
    {
      async beginIdempotentRequest(args): Promise<IdempotencyBeginResult> {
        const token = globalThis.crypto.randomUUID()
        const result = await client.query<IdempotencyRow>(
          `${IDEMPOTENCY_BEGIN_SQL}
with inserted as (
  insert into ${tableName} (
    idempotency_key,
    status,
    owner,
    token,
    result_json,
    expires_at
  )
  values ($1, 'in_progress', $2, $3, null, $4)
  on conflict (idempotency_key) do nothing
  returning 'acquired'::text as outcome, token, null::text as result_json, null::bigint as retry_after_ms, 1 as stage
),
refreshed as (
  update ${tableName}
  set
    status = 'in_progress',
    owner = $2,
    token = $3,
    result_json = null,
    expires_at = $4
  where idempotency_key = $1
    and expires_at <= $5
  returning 'acquired'::text as outcome, token, null::text as result_json, null::bigint as retry_after_ms, 2 as stage
),
existing as (
  select
    case
      when status = 'completed' then 'replay'
      else 'in_progress'
    end as outcome,
    token,
    result_json,
    case
      when status = 'completed' then null::bigint
      else greatest(expires_at - $5, 0)
    end as retry_after_ms,
    3 as stage
  from ${tableName}
  where idempotency_key = $1
)
select outcome, token, result_json, retry_after_ms
from (
  select * from inserted
  union all
  select * from refreshed
  union all
  select * from existing
) rows
order by stage
limit 1`,
          [
            args.key,
            args.owner,
            token,
            args.nowMs + args.ttlMs,
            args.nowMs
          ]
        )
        const row = result.rows[0]
        if (row === undefined || row.outcome === 'acquired') {
          return { kind: 'acquired', token: row?.token ?? token }
        }
        if (row.outcome === 'replay') {
          return {
            kind: 'replay',
            result: JSON.parse(row.result_json ?? '{}') as CallToolResult
          }
        }
        return {
          kind: 'in_progress',
          ...(row.retry_after_ms === null
            ? {}
            : { retryAfterMs: row.retry_after_ms })
        }
      },
      async completeIdempotentRequest(args) {
        await client.query(
          `${IDEMPOTENCY_COMPLETE_SQL}
update ${tableName}
set
  status = 'completed',
  owner = null,
  token = null,
  result_json = $3,
  expires_at = $4
where idempotency_key = $1
  and status = 'in_progress'
  and token = $2`,
          [
            args.key,
            args.token,
            JSON.stringify(args.result),
            args.nowMs + args.ttlMs
          ]
        )
      },
      async abandonIdempotentRequest(args) {
        await client.query(
          `${IDEMPOTENCY_ABANDON_SQL}
delete from ${tableName}
where idempotency_key = $1
  and status = 'in_progress'
  and token = $2`,
          [args.key, args.token]
        )
      }
    },
    {
      adapter: 'PostgresIdempotencyStore',
      support: 'production'
    }
  )
}

export const postgresPolicyStatements = {
  AUDIT_INSERT_SQL,
  IDEMPOTENCY_ABANDON_SQL,
  IDEMPOTENCY_BEGIN_SQL,
  IDEMPOTENCY_COMPLETE_SQL
} as const

export const postgresPolicySchema = {
  auditStore(options: { tableName?: string } = {}): readonly string[] {
    const tableName = options.tableName ?? 'mcp_audit_events'
    return [
      `create table if not exists ${tableName} (
  id bigserial primary key,
  correlation_id text not null,
  outcome text not null,
  subject text null,
  tenant_id text null,
  tool text not null,
  created_at timestamptz not null default now()
)`,
      `create index if not exists ${tableName}_correlation_idx on ${tableName} (correlation_id, created_at desc)`,
      `create index if not exists ${tableName}_tool_idx on ${tableName} (tool, created_at desc)`
    ]
  },
  idempotencyStore(options: { tableName?: string } = {}): readonly string[] {
    const tableName = options.tableName ?? 'mcp_idempotency_keys'
    return [
      `create table if not exists ${tableName} (
  idempotency_key text primary key,
  status text not null,
  owner text null,
  token text null,
  result_json text null,
  expires_at bigint not null
)`,
      `create index if not exists ${tableName}_expires_idx on ${tableName} (expires_at)`
    ]
  }
} as const
