# Testing strategy (current coverage)

Layers from spec §15.1 and where they live today:

| Layer                | Location                                            | Status                                                         |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| Geometry unit        | `packages/geometry/src/geometry.test.ts`            | projection, winding, tolerance, transforms, imperial display   |
| Contracts unit       | `packages/contracts/src/manifest.test.ts`           | manifest schema incl. traversal/duplicate/credential rejection |
| Config unit          | `packages/config/src/index.test.ts`                 | env validation, production fail-closed                         |
| Auth unit            | `packages/auth/src/index.test.ts`                   | dev-token verifier, clerk config guard                         |
| Storage unit         | `packages/storage/src/fsDriver.test.ts`             | round-trip, traversal rejection                                |
| Fixtures unit        | `packages/roomplan-fixtures`                        | determinism, real-hash manifests                               |
| Database integration | `packages/database/src/tenancy.integration.test.ts` | tenant isolation, state machine, handoff tokens, job queue     |
| API integration      | `apps/api/src/api.integration.test.ts`              | auth, cross-tenant, idempotency, uploads/checksums, lifecycle  |
| Worker integration   | `apps/worker/src/importCapture.integration.test.ts` | fixture import, duplicate-job safety, checksum failure path    |
| StudioKL contract    | `integrations/studiokl/src/webhook.test.ts`         | signing, replay window, rotation, idempotent consumer          |
| iOS unit             | `apps/ios/PropertyScan/Tests`                       | state machine, manifest/checksums (requires macOS/Xcode)       |

Integration tests create a throwaway database per suite via
`packages/database/src/testing.ts` (needs `DATABASE_URL` pointing at a local
PostgreSQL; `make verify` starts one).

Not yet covered (tracked in docs/STATUS.md): browser E2E, web component tests,
export determinism/golden files, ground-truth field validation protocol
(spec §15.2 — no accuracy claims may be made until that data exists).
