# ADR 0007 — RoomPlan geometry normalization (Phase 3 core)

Date: 2026-07-22 · Status: accepted

## Decision

The import pipeline derives canonical 2D geometry from RoomPlan's Codable
export:

- **Walls**: a wall's plan segment is its local X extent (`dimensions[0]`)
  centered on its 4×4 column-major transform, projected X/Z → (x, y). Multiroom
  placement composes the structure result's per-room world transform first.
- **Room boundaries**: wall segments are assembled into a closed loop by
  snapping endpoints within 5 cm; success requires every corner to join exactly
  two wall ends and a single walk to visit every wall. Failures produce a
  `room_not_closed` finding and the boundary stays `not_processed` — geometry
  is never invented (guardrail §20).
- **Openings**: windows/doors/passages attach to their `parentIdentifier` wall;
  the stored offset is the opening center along the wall from its start. Sill
  height = center elevation − height/2 for windows, 0 for doors, null for
  passages. Unattachable openings keep `wallId: null` plus an
  `opening_unattached` finding for the review workflow.
- **Identifiers**: payload wall/opening/room ids are freshly minted UUIDv7 per
  revision; the RoomPlan surface identifier is preserved as `sourceId` (and in
  relational `source_metadata`). Source ids cannot be primary keys because the
  same physical surface recurs across revisions and re-imports.
- **Dual storage** per ADR 0003: the revision JSONB payload is authoritative;
  `rooms`/`walls`/`openings` rows are queryable projections written in the same
  transaction.

## Consequences

Schedules (`/v1/plans/{id}/schedules/windows|doors`) project directly from the
current revision payload with display-only imperial formatting and an explicit
preliminary-measurement disclaimer. Accuracy remains unvalidated until the
§15.2 ground-truth study; nothing in this pipeline asserts a tolerance.
