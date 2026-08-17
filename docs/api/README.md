# API overview (implemented surface)

REST under `/v1`. Errors are RFC 9457 `application/problem+json`. Timestamps are
UTC ISO 8601. IDs are UUIDv7. Collections use cursor pagination
(`?limit=&cursor=`, `nextCursor` in responses).

Authentication: `Authorization: Bearer <token>` (Clerk session JWT, or
`dev_<userId>` in development). Tenant selection: `X-Organization-Id` header —
validated server-side against memberships; it is never authorization by itself.

Capture modes: `POST /v1/scan-sessions` accepts optional `captureMode`
(`interior_roomplan` default, `exterior_facade`, `opening_verification`).
Non-interior modes and all facade endpoints are gated by server-enforced tenant
entitlements (`exterior_capture` is disabled by default) and return 403 with an
explanatory problem when not granted.

`Idempotency-Key` is **required** on `POST /v1/scan-sessions`. Replays with the
same key+body return the stored response; same key with different body → 422.

| Method & path                                                            | Purpose                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`, `GET /health/ready`                                  | liveness/readiness (readiness checks the database)                                                                           |
| `POST /v1/organizations`                                                 | create org; caller becomes owner                                                                                             |
| `GET /v1/organizations`                                                  | orgs the caller belongs to                                                                                                   |
| `POST /v1/properties` · `GET /v1/properties` · `GET /v1/properties/{id}` | property records                                                                                                             |
| `POST /v1/properties/{id}/floors`                                        | add a floor                                                                                                                  |
| `POST /v1/scan-sessions`                                                 | create scan session (idempotent)                                                                                             |
| `GET /v1/scan-sessions/{id}`                                             | session state incl. `planId`/`failureReason`                                                                                 |
| `POST /v1/scan-sessions/{id}/status`                                     | device-reported state-machine transition (`{from,to}`, validated)                                                            |
| `POST /v1/scan-sessions/{id}/handoff-token`                              | issue single-use deep-link token (15 min TTL)                                                                                |
| `POST /v1/scan-handoff/redeem`                                           | unauthenticated single-use token redemption → capture-scoped metadata                                                        |
| `POST /v1/scan-sessions/{id}/uploads`                                    | register bundle upload (idempotent per captureId); returns presigned URL (s3) or local PUT route (fs)                        |
| `GET /v1/scan-sessions/{id}/uploads/{uploadId}`                          | resume state: received and missing part numbers                                                                              |
| `PUT /v1/scan-sessions/{id}/uploads/{uploadId}/parts/{n}`                | local-driver chunk upload (idempotent per part; S3 uses presigned per-part URLs)                                             |
| `PUT /v1/scan-sessions/{id}/uploads/{uploadId}/content`                  | local-driver byte upload                                                                                                     |
| `POST /v1/scan-sessions/{id}/uploads/{uploadId}/complete`                | verify SHA-256 + size against stored bytes                                                                                   |
| `POST /v1/scan-sessions/{id}/complete`                                   | transition to processing, create import run, enqueue idempotent import job                                                   |
| `GET /v1/plans/{id}`                                                     | plan + current revision (payload includes explicit `not_processed` geometry fields)                                          |
| `GET /v1/plans/{id}/revisions/{revisionId}`                              | immutable revision                                                                                                           |
| `GET /v1/plans/{id}/openings`                                            | openings of the current revision                                                                                             |
| `GET /v1/plans/{id}/schedules/windows` · `.../doors`                     | keyed schedules with room names, imperial/metric display, and a preliminary-measurement disclaimer                           |
| `POST /v1/properties/{id}/facades` · `GET .../facades`                   | exterior facade records (ADR 0006)                                                                                           |
| `POST /v1/facades/{id}/openings` · `GET .../openings`                    | exterior openings (window/door/garage_door/vent/other)                                                                       |
| `POST /v1/measurements`                                                  | manual/laser measurement with provenance; `fieldVerified: true` requires a laser/manual source and records verifier identity |

The HTTP contract is formalized in [`openapi.yaml`](./openapi.yaml) (OpenAPI
3.1) and verified against the running router by
`apps/api/src/openapi.contract.integration.test.ts` — every documented
operation must be routed, and public (unauthenticated) access is allowlisted.
Request/response field shapes remain authoritatively defined by the zod
schemas in `packages/contracts`.

Media endpoints (Phase 3): registration → byte upload (presigned or local) →
completion with checksum + MIME-signature validation, JPEG Exif APP1 removal,
and pixel dimensions; authorized downloads via short-lived signed URLs (S3) or
API streaming (fs); photo links to openings ordered by position.
