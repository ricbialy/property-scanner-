# ADR 0005 — Dev/prod auth modes and storage drivers (deviation notes)

Date: 2026-07-21 · Status: accepted

## Context

The spec mandates Clerk identity and S3-compatible object storage. Local
development, CI, and this scaffolding environment have no Clerk instance, no
Docker daemon (in some sandboxes), and no S3 endpoint.

## Decision

1. **Auth**: `packages/auth` verifies Clerk session JWTs manually with `jose`
   against the instance JWKS (issuer/expiry/azp checks per Clerk's manual-JWT
   guidance) instead of pulling the Clerk SDK into the API. `AUTH_MODE=dev`
   accepts `dev_<userId>` bearer tokens for local/test only; `packages/config`
   refuses it outside development/test. The application database owns
   organizations, memberships, and roles either way.
2. **Storage**: `packages/storage` (an addition to the spec's package list)
   abstracts object storage. `s3` driver (AWS SDK, presigned PUT URLs,
   MinIO-compatible) is required in production; `fs` driver serves local dev and
   tests, with the API accepting bundle bytes on a local upload route in place
   of a presigned URL.
3. **Local infra**: `compose.yaml` (PostgreSQL + MinIO) when Docker exists;
   `scripts/local-postgres.sh` runs an embedded PostgreSQL cluster otherwise so
   `make verify` works in restricted sandboxes.

## Consequences

Client code paths differ only at the "where do I PUT bytes" step, which the API
already abstracts through `uploadUrl`. Web-side Clerk UI integration remains to
be wired when real keys exist (tracked in docs/STATUS.md).
