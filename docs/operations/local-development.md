# Local development

## Prerequisites

- Node 22 LTS with corepack (`corepack enable` gives you the pinned pnpm).
- Either Docker (recommended: PostgreSQL 16 + MinIO via `compose.yaml`) or
  local PostgreSQL 16 binaries (the scripts fall back to an embedded cluster
  under `.local/pgdata`).

## Commands

```bash
make bootstrap    # install deps, start infra, migrate, seed demo tenant
make dev          # api (:4000), worker, web (:3000) in watch mode
make verify       # what CI runs
make demo         # scripted end-to-end vertical slice (build first: pnpm build)
make db-up / db-down
```

## Authentication in development

`AUTH_MODE=dev` accepts `Authorization: Bearer dev_<userId>`. The seed creates
`user_demo_owner` owning "Demo Construction Co". The web shell sends
`dev_${NEXT_PUBLIC_DEV_USER_ID:-user_demo_owner}`.

To exercise real Clerk verification locally set `AUTH_MODE=clerk` and
`CLERK_JWT_ISSUER=https://<instance>.clerk.accounts.dev`, then pass a real
session token. Production always runs `AUTH_MODE=clerk`; `dev` mode is refused
at startup.

## Object storage in development

`STORAGE_DRIVER=fs` stores objects under `.local/objects` and the API accepts
bundle bytes directly on the local upload route. With Docker, switch to
`STORAGE_DRIVER=s3` and the MinIO settings from `.env.example` to exercise the
presigned-URL path.

## Safety defaults

- `DISABLE_EXTERNAL_WEBHOOKS=true` — no outbound webhook leaves the machine.
- The seed refuses to run when `APP_ENV=production`.
- `.env` is gitignored; `.env.example` contains placeholders only.
