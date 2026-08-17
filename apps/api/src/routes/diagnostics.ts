import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../context.js";
import { sendProblem } from "../problems.js";

/**
 * Owner-facing testing panel data. Authenticated (any signed-in user) but not
 * tenant-scoped: it reports infrastructure health, never tenant data.
 */
export function registerDiagnosticsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/diagnostics", async (request, reply) => {
    if (!request.identity) {
      return sendProblem(reply, 401, "Authentication required");
    }

    let database = "ok";
    let lastJob: unknown = null;
    let failedJobs = 0;
    let deadJobs = 0;
    let lastUpload: unknown = null;
    let workerSeenRecently = false;
    try {
      const jobRes = await deps.pool.query(
        "select job_type, status, updated_at, last_error from jobs order by updated_at desc limit 1"
      );
      lastJob = jobRes.rows[0]
        ? {
            jobType: jobRes.rows[0].job_type,
            status: jobRes.rows[0].status,
            updatedAt: jobRes.rows[0].updated_at.toISOString(),
            lastError: jobRes.rows[0].last_error
          }
        : null;
      // A worker touched a job in the last 2 minutes = alive (poll interval 1s).
      const heartbeat = await deps.pool.query(
        "select 1 from jobs where locked_by is not null and updated_at > now() - interval '2 minutes' limit 1"
      );
      const recentDone = await deps.pool.query(
        "select 1 from jobs where status in ('succeeded','failed','dead') and updated_at > now() - interval '2 minutes' limit 1"
      );
      workerSeenRecently = heartbeat.rows.length > 0 || recentDone.rows.length > 0;
      const failed = await deps.pool.query(
        "select count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'dead') as dead from jobs"
      );
      failedJobs = Number(failed.rows[0].failed);
      deadJobs = Number(failed.rows[0].dead);
      const uploadRes = await deps.pool.query(
        "select status, byte_size, updated_at from capture_artifacts order by updated_at desc limit 1"
      );
      lastUpload = uploadRes.rows[0]
        ? {
            status: uploadRes.rows[0].status,
            byteSize: uploadRes.rows[0].byte_size ? Number(uploadRes.rows[0].byte_size) : null,
            updatedAt: uploadRes.rows[0].updated_at.toISOString()
          }
        : null;
    } catch {
      database = "failed";
    }

    let storage = "ok";
    try {
      const key = "diagnostics/roundtrip.txt";
      const probe = new TextEncoder().encode(`probe-${Date.now()}`);
      await deps.storage.put(key, probe, "text/plain");
      const back = await deps.storage.get(key);
      if (Buffer.from(back).toString() !== Buffer.from(probe).toString()) {
        storage = "failed";
      }
    } catch {
      storage = "failed";
    }

    return {
      appEnv: deps.env.APP_ENV,
      version: process.env["npm_package_version"] ?? "0.1.0",
      commit: process.env["APP_COMMIT"] ?? "unknown",
      authMode: deps.env.AUTH_MODE,
      storageDriver: deps.env.STORAGE_DRIVER,
      externalWebhooksDisabled: deps.env.DISABLE_EXTERNAL_WEBHOOKS,
      checks: { database, storage },
      worker: { seenRecently: workerSeenRecently, lastJob, failedJobs, deadJobs },
      lastUpload
    };
  });
}
