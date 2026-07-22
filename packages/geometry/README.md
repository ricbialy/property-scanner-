# @propertyscan/geometry

Pure geometry operations for the canonical Property Scan spatial model. No I/O, no
framework dependencies. Everything downstream (normalization, editor, rendering)
consumes these conventions.

## Coordinate conventions (canonical)

- **Canonical unit: meter.** Imperial is display-only and produced by conversion helpers.
- **3D source space:** right-handed, Y up, matching ARKit/RoomPlan world space.
  Source transforms are 4×4 matrices serialized **column-major** and preserved only when
  a 3D source transform must be retained.
- **Canonical floor plan:** the 3D `X/Z` plane projected to 2D `(x, y)` in a
  floor-local coordinate system: `x = worldX`, `y = worldZ`. The floor origin is
  floor-local and arbitrary but consistent within one plan revision.
- **Vertical coordinate:** meters above the floor datum (`elevation`), stored
  separately from the 2D plan coordinates.
- **Angles:** radians in storage; degrees only in human-facing exports.
- **Polygon winding:** room boundary polygons are stored **counter-clockwise (CCW)**
  in the plan coordinate system (positive signed area). `ensureCcw` enforces this.
- **Tolerance:** floating-point coordinates are never compared with exact equality.
  `EPSILON_LENGTH_M` (1 mm) is the central length tolerance; use `nearlyEqual`.

These conventions are enforced by the tests in `src/*.test.ts`. Changing any of them
requires an ADR and a geometry schema version bump.
