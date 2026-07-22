# @propertyscan/roomplan-fixtures

Sanitized, deterministic capture-bundle fixtures so backend and web development
never depend on a connected iPhone.

The fixture data is hand-authored in the _shape_ of RoomPlan's Codable
`CapturedRoom`/`CapturedStructure` export (identifiers, `dimensions` as
width/height/depth in meters, column-major 4×4 `transform`s), with plausible
residential geometry. It contains no real address, imagery, or scan of an actual
property. When Phase 2 produces real device captures, sanitized real bundles
should be added alongside — not instead of — these deterministic ones.

`buildFixtureBundle()` assembles the two-room bundle as an in-memory zip and a
`manifest.json` whose SHA-256 values are computed from the actual bytes, so the
manifest contract is always exercised for real.
