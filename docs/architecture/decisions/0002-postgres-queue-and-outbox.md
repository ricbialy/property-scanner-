# ADR 0002 — PostgreSQL-backed job queue and transactional outbox

Date: 2026-07-21 · Status: accepted

## Decision

Async work (imports, exports, webhook delivery) runs through a `jobs` table in
PostgreSQL claimed with `FOR UPDATE SKIP LOCKED`, plus an `outbox_events` table
appended in the same transaction as domain commits. No extra queue service in V1
(spec §4.1).

## Details

- Jobs are idempotent by unique `job_key` (e.g. `import:<sessionId>:<bundleSha>`);
  duplicate enqueues return the existing job.
- Retries use exponential backoff (5s · 2^attempt, capped 10 min); exceeding
  `max_attempts` moves the job to a `dead` status with the last error retained.
- Workers poll; claims mark `locked_at`/`locked_by`. Lease/heartbeat recovery for
  crashed workers is Phase 6 hardening.
- Webhooks are dispatched only from committed outbox rows, guaranteeing no
  notification before durable, readable state (spec §14.1).

## Consequences

Single dependency (PostgreSQL) for correctness-critical async behavior; if
throughput ever demands it, the queue can be swapped without changing job
semantics because idempotency lives in `job_key`, not the transport.
