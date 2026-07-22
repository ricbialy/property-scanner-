# ADR 0004 — Canonical geometry coordinate conventions

Date: 2026-07-21 · Status: accepted

## Decision

- Canonical unit: **meter**; imperial is display-only (tenant-configured
  fraction increments, e.g. nearest 1/8").
- 3D source space: right-handed, **Y-up** (ARKit/RoomPlan convention); 4×4
  transforms serialized **column-major**, preserved only when needed.
- Canonical 2D floor plan: X/Z projection to floor-local `(x, y)`; vertical
  position stored separately as meters above floor datum.
- Angles: radians in storage.
- Room polygons: **CCW winding** (positive shoelace area).
- Central tolerances in `packages/geometry` (1 mm length, 1e-4 rad, 1e-6 m²);
  exact floating-point equality is forbidden.

Enforced by `packages/geometry` tests; documented in its README. Changing any
convention requires a geometry schema version bump and a superseding ADR.
