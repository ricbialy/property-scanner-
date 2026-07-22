# Privacy and data handling (V1 baseline)

Interior floor plans and capture data are sensitive. Baseline rules implemented
or enforced by design in this codebase:

- **Capture bundles** contain RoomPlan JSON, optional USDZ, opening photos, and
  a manifest. Camera frames, point clouds, and detailed telemetry are **not**
  uploaded; any future collection needs explicit purpose, retention, consent,
  and tenant controls (spec §6.3).
- **Manifests must not contain credentials** — enforced by schema validation on
  both device (tests) and server (import pipeline).
- **Handoff deep links** carry an opaque token that is single-use, short-lived
  (15 min), and stored only as a SHA-256 hash.
- **Object keys are server-chosen**; clients never receive storage credentials.
  fs driver is dev-only; production requires S3 with provider encryption at
  rest and TLS in transit.
- **Logs carry IDs and state transitions**, never raw geometry or signed URLs;
  the shared logger redacts authorization/token/signedUrl fields as defense in
  depth.
- **EXIF policy**: media records default to `strip_gps`; thumbnail/EXIF
  processing lands with the media pipeline (Phase 4/5).
- **Audit events** exist for organization creation, property/scan creation, and
  handoff issuance; membership changes, exports, credential changes, accepted
  revisions, and deletions are added as those features land.
- **Open before public SaaS launch** (spec §13): tenant data export/deletion
  design, retention configuration for raw captures and deleted tenants.
