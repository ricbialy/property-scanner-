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

## Status

Phase 0 (repo/toolchain/infra) and Phase 1 (tenanted SaaS + scan-session
vertical slice) are implemented with tests, plus: the capture-bundle manifest
contract, a deterministic two-room RoomPlan fixture, the worker import pipeline
producing an initial immutable plan revision (geometry explicitly
`not_processed` pending Phase 3 normalization), and the iOS capture shell.
`docs/STATUS.md` tracks exactly what is and is not done.
