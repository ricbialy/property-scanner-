# Implementation status

Honest ledger against `docs/PROPERTY_SCAN_DEV.md`. Nothing below claims more
than the tests demonstrate.

## Done (with tests)

**Phase 0 — repository & architecture baseline**

- pnpm/Turborepo monorepo, pinned toolchain, strict TS, shared lint/format.
- Local infra: `compose.yaml` (PostgreSQL+MinIO) with embedded-postgres fallback.
- Full initial schema (all spec §16 tables) with forward-only migration runner.
- ADRs 0001–0005; CI workflow (format, lint, typecheck, build, unit, migration
  check ×2, integration); `.env.example`; secret-safe `.gitignore`; health
  endpoints.

**Phase 1 — SaaS & scan-session vertical slice**

- Identity: Clerk JWT verification via JWKS (manual per Clerk docs) + dev mode;
  DB-owned organizations/memberships/roles (owner/admin/member/viewer).
- Tenant-safe data access: org-scoped repositories; header is selector only;
  cross-tenant access returns 404 (proven in API + DB integration tests).
- Properties, floors, scan sessions with validated state machine, guarded
  concurrent transitions, Idempotency-Key handling, audit events.
- Handoff tokens: single-use, 15-min TTL, hash-only storage, deep link + browser
  fallback URL, unauthenticated redeem endpoint.
- Minimal web dashboard (orgs → properties → floors → scan session → deep link).

**First-work-order extras**

- Capture manifest contract v1.0 (zod schema; credential/traversal rejection).
- Deterministic sanitized two-room RoomPlan fixture with real SHA-256 manifests.
- Upload flow: server-chosen object keys, presigned URL (s3) or local PUT (fs),
  checksum-verified completion, idempotent per captureId.
- Worker import pipeline: manifest/checksum verification, immutable raw artifact
  preservation, version-tolerant RoomPlan adapter, quality findings, transactional
  plan + initial immutable revision with **explicit `not_processed` geometry**,
  outbox events after durable commit, terminal-failure path with visible reason.
- iOS capture shell: capability gating, deep-link parsing, local state machine,
  manifest builder with SHA-256, offline upload queue skeleton, RoomPlan
  controller (`RoomCaptureView`) — **not yet compiled** (no macOS in this
  environment) and not field-ready.
- StudioKL reference pieces: signed webhook envelope (HMAC-SHA256, timestamp
  tolerance, key rotation), idempotent consumer example, field-mapping draft.
- `make demo` / `scripts/demo-vertical-slice.sh`: the complete placeholder-free
  path from tenant creation to normalized plan.

**Exterior layer (ADR 0006)**

- Facades and facade openings per property (tenant-scoped, tested), with
  optional links to interior plan openings.
- `POST /v1/measurements`: manual/laser measurements with full provenance;
  `field_verified` requires user identity + timestamp + manual/laser source and
  append-only history; verified width/height/sill denormalizes onto the facade
  opening for display.
- Honest scope: documentation-first — no automatic exterior reconstruction is
  claimed. iOS exterior photo UX and web facade panel are follow-ups.

**Phase 3 geometry normalization (ADR 0007)**

- Walls derived from RoomPlan centered transforms (multiroom structure
  transforms composed), room boundaries assembled from wall loops with
  tolerance snapping, openings attached to host walls with offsets and sill
  heights; unresolvable geometry stays explicitly `not_processed` with
  findings (`room_not_closed`, `opening_unattached`, …).
- Fresh UUIDv7 payload ids per revision with RoomPlan `sourceId` provenance;
  relational room/wall/opening projections written transactionally.
- Schedules: `GET /v1/plans/{id}/openings` and
  `/v1/plans/{id}/schedules/windows|doors` with display-only imperial
  formatting and a preliminary-measurement disclaimer.

## Not done (next)

- **Phase 2**: real device capture, multiroom structure UX, opening photos,
  background resumable uploads, iOS compilation on macOS CI, sanitized real
  device fixtures.
- **Phase 3 remainder**: media upload pipeline (photos, thumbnails, EXIF
  stripping), richer topology validation (overlaps, duplicate surfaces across
  rooms), shared-door dedup across adjacent rooms, OpenAPI document.
- **Exterior follow-ups**: iOS exterior photo capture UX, web facade panel,
  facade media attachment endpoints.
- **Phase 4**: browser editor (commands, undo/redo, optimistic concurrency),
  revision accept/compare, measurement verification UI.
- **Phase 5**: SVG/PDF rendering package, export jobs, webhook delivery worker
  (dispatcher for the outbox), StudioKL contract tests against the real repo.
- **Phase 6**: threat-model fixes (rate limiting, RLS, malware scanning), load
  tests, telemetry (OTel wiring), ground-truth field validation study.
- Clerk front-end wiring in the web app (needs real keys).
- Rate limiting on auth/token/upload/export endpoints.
- Row-level security as defense in depth.

## Standing constraints

- No accuracy claims until the spec §15.2 ground-truth study exists.
- RoomPlan output is preliminary estimation; verification workflow required
  before any measurement is treated as installation-ready.
