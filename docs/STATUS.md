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

## Phase 2 progress (native capture & durable upload)

- **Resumable chunked uploads (server, tested)**: uploads register a part
  count; parts are stored as sibling objects and recorded per part (idempotent
  re-upload); `GET .../uploads/{id}` reports received/missing parts for resume;
  completion refuses missing parts with the exact list, assembles the bundle,
  and checksum-verifies the whole payload.
- **iOS Phase 2 sources (not yet compiled — no macOS here)**: multiroom capture
  model with RoomPlan `StructureBuilder` merge, room naming/deletion before
  upload, bundle packager (manifest hashing real bytes, ZIPFoundation archive),
  API client (handoff redeem, status transitions, upload registration/parts/
  completion), and a resumable uploader that asks the server for missing parts
  and uploads only those. Chunk math covered by XCTest.
- **Import fixture matrix**: single-room, missing-wall (unclosable boundary →
  finding, `not_processed`), and unsupported-schema variants added and tested.
- **CI**: opt-in macOS simulator build+test job (`ENABLE_IOS_CI=true`).
- **Remaining for Phase 2 exit**: compile and run on iPhone 15 Pro / iPad Pro,
  capture UX polish (coaching, room connection prompts, review screen), opening
  photo capture, background URLSession transfers, sanitized real-device bundle
  checked in alongside the synthetic fixtures.

## Exterior roadmap (amendment, Phases 7A–8 — not started by design)

Per `docs/PROPERTY_SCAN_EXTERIOR_FACADE_AMENDMENT.md` §19, exterior
implementation begins only after interior V1 is stable or is explicitly
reprioritized. Compatibility groundwork already landed: capture-mode
discriminator, server-enforced entitlements (exterior disabled by default),
reserved contract enums, adapter boundary (ADR 0008).

- **7A — Exterior research prototype**: guided single-facade native capture
  (ARKit poses, intrinsics, frames, depth/mesh inventory), immutable manifest +
  resumable upload, coarse plane fitting, facade-local projection of
  user-marked reference dimensions, deterministic fixtures, field tests.
- **7B — Opening detection & deduplication**: pluggable detector interface,
  lawful labeled dataset with property-level splits, cross-frame tracking,
  duplicate suppression, calibrated thresholds, human-review queue. No accuracy
  claims before baseline evaluation.
- **7C — Exterior editor & outputs**: elevation workspace, typed commands,
  immutable facade revisions, grouping/schedules, wall/glazing/cladding areas,
  SVG/PDF, StudioKL webhook flow.
- **7D — Interior/exterior reconciliation**: OpeningMatchCandidate scoring,
  manual confirm/reject, no automatic merges without a calibrated policy.
- **8 — Larger-facade research** (photogrammetry/professional scans/drone
  imagery as adapters) only after the phone baseline is measured.
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
