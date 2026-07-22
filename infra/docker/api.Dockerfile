# Property Scan API container. Build from the repository root:
#   docker build -f infra/docker/api.Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
COPY integrations ./integrations
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
USER node
CMD ["node", "apps/api/dist/main.js"]
