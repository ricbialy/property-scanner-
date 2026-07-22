import Fastify, { type FastifyInstance } from "fastify";
import { createLogger } from "@propertyscan/observability";

import type { AppDeps } from "./context.js";
import { registerAuth } from "./plugins/auth.js";
import { sendProblem } from "./problems.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerPropertyRoutes } from "./routes/properties.js";
import { registerScanSessionRoutes } from "./routes/scanSessions.js";
import { registerExteriorRoutes } from "./routes/exterior.js";

export function buildServer(deps: AppDeps): FastifyInstance {
  // Cast: pino's Logger is runtime-compatible with FastifyBaseLogger but their
  // generic signatures differ; normalizing here keeps route modules on the
  // default FastifyInstance type.
  const app = Fastify({
    loggerInstance: createLogger("api"),
    bodyLimit: deps.env.UPLOAD_MAX_BYTES,
    genReqId: () => crypto.randomUUID()
  }) as unknown as FastifyInstance;

  // Raw binary bodies for local bundle uploads (fs storage driver).
  app.addContentTypeParser(
    ["application/zip", "application/octet-stream"],
    { parseAs: "buffer", bodyLimit: deps.env.UPLOAD_MAX_BYTES },
    (_request, payload, done) => done(null, payload)
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, "request failed");
    // Never leak stack traces or internals to clients.
    void sendProblem(reply, 500, "Internal server error");
  });

  app.setNotFoundHandler((_request, reply) => {
    void sendProblem(reply, 404, "Not found");
  });

  registerAuth(app, deps);
  registerHealthRoutes(app, deps);
  registerOrganizationRoutes(app, deps);
  registerPropertyRoutes(app, deps);
  registerScanSessionRoutes(app, deps);
  registerPlanRoutes(app, deps);
  registerExteriorRoutes(app, deps);

  return app;
}
