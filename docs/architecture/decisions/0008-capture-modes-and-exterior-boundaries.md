# ADR 0008 — Capture modes, entitlements, and interior/exterior boundaries

Date: 2026-07-22 · Status: accepted

## Context

The exterior facade amendment (`docs/PROPERTY_SCAN_EXTERIOR_FACADE_AMENDMENT.md`)
adds a facade-capture engine to the same platform, to be implemented in Phases
7A–7D **after** the interior V1. During interior work only bounded,
backward-compatible changes are allowed (amendment §19.1). The interior
vertical slice is stable (all suites green), so those changes are safe now.

## Decisions

1. **Capture-mode discriminator.** `scan_sessions.capture_mode` ∈
   `interior_roomplan | exterior_facade | opening_verification`, defaulting to
   `interior_roomplan`; migration 0003 explicitly maps pre-existing records.
   `POST /v1/scan-sessions` accepts an optional `captureMode` — omitted keeps
   interior behavior byte-for-byte, proven by compatibility tests.
2. **Server-enforced entitlements.** `entitlements` table with the amendment's
   keys. Defaults: `interior_capture` and `api_access` on; everything else —
   including `exterior_capture` and `facade_auto_detection` — OFF until the
   phase acceptance gates pass. Enforcement lives in the API (403 with reason),
   never only hidden UI. Grants record the granting identity for audit.
3. **Adapter boundary.** RoomPlan types stay confined to the worker's interior
   adapter (`roomplanAdapter.ts` + `normalizeGeometry.ts`); domain services,
   contracts, and the API carry only vendor-neutral geometry. The future facade
   pipeline gets its own worker modules (`facade-processing/*` per amendment
   §10) and its own capture-bundle contract — RoomPlan is never the exterior
   engine.
4. **Reserved contracts only.** `CaptureMode`, `ExteriorOpeningType`,
   `DetectionState`, `OcclusionState`, and entitlement keys are reserved in
   `@propertyscan/contracts`. No detector, no mesh viewer, no fake exterior
   scanner is implemented or claimed; the existing documentation-first facade
   records (ADR 0006) remain the only shipped exterior surface, now gated
   behind `exterior_capture`.
5. **Facade model alignment.** ADR 0006's facades/facade_openings are a
   compatible subset of the amendment's §7.2 model. Coordinate frames, plane
   segments, facade revisions, opening observations, and match candidates are
   deliberately deferred to Phase 7A+ rather than reserved as dead columns.

## Consequences

Interior clients are unaffected (tested). Exterior work can begin later without
schema rewrites, and nothing exposed today implies exterior capability that
does not exist. Phases 7A–7D and their exit criteria are tracked in
`docs/STATUS.md`.
