# StudioKL reference integration

Reference consumer showing how StudioKL integrates with Property Scan without
coupling either system's database to the other. Property Scan never writes to
StudioKL's production database; StudioKL pulls normalized data through the
authenticated API after webhook notification.

## Status

This milestone ships the webhook envelope contract, HMAC-SHA256
signing/verification with replay protection, and an idempotent event-handler
example with tests. The full sample client, opening-field mapping fixtures, and
contract tests against StudioKL's real repository land in Phase 5 — the
StudioKL repo was not available for inspection in this environment, so the
final endpoint/table mapping (spec §22) remains open.

## Workflow

1. StudioKL calls `POST /v1/scan-sessions` with `externalReferences:
[{"system": "studiokl", "type": "job", "value": "job_123"}]`.
2. Property Scan returns a deep link / QR URL for the field user.
3. After capture and correction, Property Scan emits `scan.needs_review`,
   `plan.accepted`, and `exports.ready` webhooks (at-least-once, signed).
4. StudioKL verifies the signature, deduplicates by event ID, and pulls
   openings/schedules/exports via the REST API.

## Field mapping (draft — confirm against the real StudioKL schema)

| Property Scan (openings)       | StudioKL (estimate/RFQ draft)      | Notes                                                   |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------- |
| `opening.id`                   | `external_opening_id`              | stable UUID, dedupe key                                 |
| `opening.type`                 | `line_item.category`               | `window` / `door` / `open_passage`                      |
| `opening.widthM` / `heightM`   | `line_item.width_in` / `height_in` | convert to inches for display; meters are canonical     |
| `opening.sillHeightM`          | `line_item.sill_height_in`         | nullable                                                |
| `opening.verification`         | `line_item.measurement_status`     | only `field_verified` should feed final quotes          |
| `opening.confidence`           | `line_item.capture_confidence`     | `high/medium/low/unknown`; never a fake percentage      |
| `opening.roomIds` → room names | `line_item.location_label`         | resolve via plan payload                                |
| media links                    | `line_item.photo_refs`             | short-lived signed URLs fetched on demand, never stored |
