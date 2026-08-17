# Property Scan

Multi-tenant SaaS for construction companies: capture an indoor property with
Apple RoomPlan on LiDAR iPhones/iPads, normalize it into a vendor-neutral
spatial model, correct it in the browser, and export floor plans, window/door
schedules, and structured JSON for downstream estimating (reference customer:
StudioKL).

> Measurements produced by this system are **preliminary estimates** unless
> independently field-verified. It is not a survey instrument or a replacement
> for final field measurement.

The implementation contract lives in `docs/PROPERTY_SCAN_DEV.md`. Architectural
decisions are recorded in `docs/architecture/decisions/`.

## Repository layout

```
apps/api        Fastify REST API (auth, tenancy, scan sessions, uploads, plans)
apps/web        Next.js dashboard (Phase 1 development shell)
apps/worker     Background jobs: capture import pipeline, retries, outbox
apps/ios        SwiftUI RoomPlan capture app (XcodeGen project, unsigned)
packages/*      contracts, database, geometry, storage, auth, config, fixtures…
integrations/   StudioKL reference adapter (webhook verify, idempotent handler)
docs/           architecture decisions, API, operations, privacy, testing
scripts/        local infra, embedded postgres, vertical-slice demo
```

## Getting started

Requires Node 22, pnpm 10 (`corepack enable`), and either Docker (PostgreSQL +
MinIO via `compose.yaml`) or local PostgreSQL 16 binaries (embedded cluster
fallback).

```bash
make bootstrap   # pnpm install, start local infra, migrate, seed
make dev         # run api + worker + web in watch mode
make verify      # format, lint, typecheck, build, unit + integration tests
make demo        # end-to-end vertical slice against the built services
```

Copy `.env.example` to `.env` for local settings. Local development defaults to
`AUTH_MODE=dev` (tokens `dev_<userId>`) and filesystem object storage; both are
refused in production, where Clerk JWT verification and S3-compatible storage
are mandatory. See `docs/operations/local-development.md`.

## Try it (no iPhone needed)

```bash
make bootstrap    # install deps, start Postgres, migrate
make test-demo    # start API+worker+web+StudioKL simulator, seed every fixture
                  # scenario, print the browser URLs to explore
make stop-demo    # stop the demo services
```

`make test-demo` walks the entire workflow with deterministic fixtures:
interrupted-and-resumed upload, geometry normalization, browser review URL,
correction + accepted revision, signed webhook, and a simulated StudioKL import
(written to `.local/studiokl-import.json`). A live testing panel is at
`/status` in the web app.

Testing on a real iPhone requires a Mac to compile the iOS app — see
`docs/testing/device-testing-guide.md` (including a no-Mac CI alternative).

## Status — read this honestly

The backend + browser workflow is **automatically tested** (58 unit + 27
integration tests, CI on every commit). The iOS app is **source implemented
but has never been compiled** (no macOS in the development environment), and
**no field validation has been performed** — measurement accuracy is unknown
until the protocol in `docs/testing/field-validation-worksheet.md` is executed.
The complete scan-a-real-property workflow is therefore **not yet MVP ready**.
The full feature-status matrix lives in `docs/STATUS.md`.
