# Store Guarantees

This page defines the minimum behavior required from production store adapters. In-memory adapters are for development and tests only unless a section says otherwise.

## SessionStore

`SessionStore` currently stores live `ManagedSession` instances, so it is only safe inside one process. Treat it as a local runtime registry, not as a production shared-state port.

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | `set(sessionId, session)` replaces the whole session binding atomically for that `sessionId`. |
| TTL        | Sessions should expire automatically when the underlying transport is closed or abandoned. |
| Cleanup    | `delete(sessionId)` must remove the binding immediately. `list()` must not return deleted sessions. |
| Retry      | `set()` and `delete()` should be safe to retry for the same `sessionId`. |
| Lease      | Not applicable in the current contract. |
| Ordering   | Last successful `set()` wins for a given `sessionId`. |
| Indexes    | Index by `sessionId`. |

## StreamableHttpEventStore

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | `storeEvent(streamId, message)` must append one durable event and return its unique `eventId`. |
| TTL        | Retain events for at least the longest supported reconnect window. |
| Cleanup    | Expired streams must be removable without corrupting surviving streams. |
| Retry      | Replaying after a transient read failure must not skip committed events. |
| Lease      | Not required. |
| Ordering   | Replay order for one `streamId` must match commit order after the supplied `lastEventId`. |
| Indexes    | Index by `eventId` and by `(streamId, append_order)`. |

## JobStore

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | `create`, `save`, and `claimNext` must each commit one complete job state transition. |
| TTL        | Keep jobs until `expiresAt`; expired jobs may be cleaned afterwards. |
| Cleanup    | Cleanup must not remove non-expired jobs or the newest terminal state. |
| Retry      | Retrying `save()` with the same terminal job state must not corrupt the record. |
| Lease      | `claimNext()` must atomically assign `leaseOwner` and `leaseExpiresAt`. Expired leases must be claimable again. |
| Ordering   | `claimNext()` must prefer the oldest eligible job for one operation. |
| Indexes    | Index by `jobId`, and by `(operation, status, expiresAt, createdAt)` for claims. |

## JobQueue

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | `notify(jobId)` must durably make work visible to waiting workers. |
| TTL        | Queue visibility may be transient; job durability belongs to `JobStore`. |
| Cleanup    | Delivered notifications may be removed after wake-up. |
| Retry      | Duplicate `notify(jobId)` calls are acceptable; workers must tolerate repeated wake-ups. |
| Lease      | Not required. |
| Ordering   | Best effort only. Workers must rely on `JobStore.claimNext()` for final ordering. |
| Indexes    | If persisted, index by enqueue time or queue key used by workers. |

## RateLimitStore

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | One `checkRateLimit()` call must atomically read and update the bucket for its key and window. |
| TTL        | Buckets must expire no later than `windowMs` after the last accepted call in that window. |
| Cleanup    | Expired buckets may be removed eagerly or lazily. |
| Retry      | A retried check may count twice; callers must only retry when they accept stricter limiting. |
| Lease      | Not required. |
| Ordering   | No cross-key ordering requirement. Same-key updates must observe one consistent bucket state. |
| Indexes    | Index by rate-limit bucket key. |

## ConcurrencyStore

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | `acquireConcurrency()` must atomically compare the current count with `limit` and either reserve one slot or reject. |
| TTL        | Production adapters should support an owner lease or timeout to recover abandoned permits. |
| Cleanup    | Releasing the last permit must remove or reset the counter. |
| Retry      | Retrying acquire without releasing may consume another slot unless the adapter uses an owner token. |
| Lease      | If a worker dies, the permit must become reclaimable after the configured lease or timeout. |
| Ordering   | No fairness guarantee is required. |
| Indexes    | Index by concurrency key. |

## AuditStore

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | `writeAuditEvent()` must persist one complete event or fail. Partial audit rows are invalid. |
| TTL        | Retention is deployment-defined; the adapter must support long-lived storage. |
| Cleanup    | Retention cleanup must be range-based and must not break chronological reads. |
| Retry      | Retrying the same event should be either idempotent or produce a clearly duplicated row with the same correlation id. |
| Lease      | Not required. |
| Ordering   | Preserve write order per correlation id when possible. |
| Indexes    | Index by `correlationId`, `tool`, and time for retention and investigations. |

## IdempotencyStore

| Concern    | Minimum guarantee |
| ---------- | ----------------- |
| Atomicity  | Result lookup and first successful result write for one key must behave as one serialized record history. |
| TTL        | Idempotent results need explicit expiry aligned with client retry expectations. |
| Cleanup    | Cleanup must remove only expired keys. |
| Retry      | Re-reading a stored successful result must return the same stable payload. |
| Lease      | Production adapters should support a reservation or in-progress marker when concurrent callers may race on the same key. |
| Ordering   | First committed successful result wins until the key expires. |
| Indexes    | Index by idempotency key, and by expiry time for cleanup. |

## Notes

- `JobStore`, `RateLimitStore`, `ConcurrencyStore`, `AuditStore`, and `IdempotencyStore` are production-facing contracts today.
- `SessionStore` is intentionally single-process today. A future production-safe session port would need serializable transport state from the underlying MCP transport.
- `JobQueue` ordering is intentionally weak; the durable source of truth is always `JobStore`.
