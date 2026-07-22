# ADR 0003 — Immutable plan revisions with JSONB payload + relational projections

Date: 2026-07-21 · Status: accepted

## Decision

Every plan correction creates a new `plan_revisions` row (spec §3.3). A revision
stores the complete normalized geometry payload as versioned JSONB
(`geometry_schema_version`), plus relational projections (`rooms`, `walls`,
`openings`) keyed by `plan_revision_id` for queryability. Revisions are never
updated after insert; acceptance flips `status` and `plans.current_revision_id`.

Unnormalized data is explicit: fields not yet produced by the pipeline carry the
literal `"not_processed"` (contracts `NOT_PROCESSED`) rather than being absent
or fabricated.

## Rationale

- JSONB payload keeps a revision self-contained and immutable — exports and the
  editor read one consistent snapshot.
- Relational projections enable schedule queries and future RLS without parsing
  JSON in every query.
- `unique (plan_id, version)` + optimistic `expectedRevision` checks (Phase 4)
  give conflict detection for concurrent edits.

## Consequences

Storage duplicates geometry between payload and projections; acceptable at V1
scale and revisit-able because the payload is authoritative.
