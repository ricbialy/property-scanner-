import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../context.js";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await deps.pool.query("select 1");
      return { status: "ok", checks: { database: "ok" } };
    } catch {
      return reply.status(503).send({ status: "unavailable", checks: { database: "failed" } });
    }
  });
}
