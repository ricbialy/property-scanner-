# ADR 0001 — Monorepo with pnpm + Turborepo, Node 22, TypeScript strict

Date: 2026-07-21 · Status: accepted

## Decision

Single monorepo per spec §8: pnpm workspaces (pinned via `packageManager`),
Turborepo as task runner, Node 22 LTS, TypeScript strict with NodeNext ESM
across all packages. Fastify 5 for the API, Next.js 15 for the web app, a plain
Node process for the worker.

## Rationale

- pnpm workspace links keep contracts/database/geometry shared without publishing.
- Turborepo gives cached `build/lint/typecheck/test` pipelines with dependency
  ordering; integration/e2e tasks are uncached by policy.
- Fastify: schema-friendly, fast, first-class content-type parser control needed
  for raw bundle uploads.

## Consequences

Every package ships `build`, `lint`, `typecheck`, `test` scripts so the root
pipeline stays uniform. ESM-only (`"type": "module"`) everywhere.
