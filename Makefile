SHELL := /bin/bash

.PHONY: bootstrap dev verify db-up db-down demo

## bootstrap: install dependencies, start local infrastructure, migrate and seed.
bootstrap:
	pnpm install
	./scripts/local-infra.sh up
	pnpm db:migrate
	pnpm db:seed

## dev: run API, worker, and web in watch mode.
dev:
	pnpm dev

## verify: everything CI runs — format, lint, typecheck, unit, integration.
verify:
	pnpm format:check
	pnpm lint
	pnpm typecheck
	pnpm build
	pnpm test
	./scripts/local-infra.sh up
	pnpm db:migrate
	pnpm test:integration

## db-up / db-down: manage local infrastructure (docker compose or embedded postgres).
db-up:
	./scripts/local-infra.sh up

db-down:
	./scripts/local-infra.sh down

## demo: run the end-to-end vertical slice against a locally running stack.
demo:
	./scripts/demo-vertical-slice.sh

## test-demo: start everything, seed all fixture scenarios, print test URLs.
test-demo:
	./scripts/test-demo.sh

## stop-demo: stop services started by test-demo.
stop-demo:
	./scripts/stop-demo.sh
