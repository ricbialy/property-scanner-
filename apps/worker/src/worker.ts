import { claimNextJob, completeJob, failJob } from "@propertyscan/database";
import type { Logger } from "@propertyscan/observability";
import type { ObjectStorage } from "@propertyscan/storage";
import type pg from "pg";

import {
  failImportCapture,
  ImportError,
  processImportCapture,
  type ImportJobPayload
} from "./importCapture.js";
import { dispatchOutbox } from "./dispatchOutbox.js";

export interface WorkerDeps {
  pool: pg.Pool;
  storage: ObjectStorage;
  log: Logger;
  workerId: string;
  webhooks?: {
    masterKey: string;
    externalWebhooksDisabled: boolean;
  };
}

/**
 * Claim and process a single job. Returns true when a job was handled.
 * Import problems (bad manifest, checksum mismatch) are terminal: the session
 * is marked failed with a user-visible reason. Infrastructure errors rethrow
 * into the retry/backoff path.
 */
export async function tick(deps: WorkerDeps): Promise<boolean> {
  const { pool, storage, log, workerId } = deps;
  // Outbox dispatch runs every tick so webhook delivery keeps pace with jobs.
  if (deps.webhooks) {
    await dispatchOutbox({
      pool,
      log,
      masterKey: deps.webhooks.masterKey,
      externalWebhooksDisabled: deps.webhooks.externalWebhooksDisabled
    }).catch((error) => log.error({ err: error }, "outbox dispatch failed"));
  }
  const job = await claimNextJob(pool, workerId);
  if (!job) {
    return false;
  }
  const jobLog = log.child({ jobId: job.id, jobType: job.job_type, attempt: job.attempts });
  jobLog.info("job started");
  try {
    if (job.job_type === "import_capture") {
      const payload = job.payload as unknown as ImportJobPayload;
      try {
        const result = await processImportCapture(pool, storage, payload);
        jobLog.info(
          { scanSessionId: payload.scanSessionId, planId: result.planId },
          "import succeeded"
        );
      } catch (error) {
        if (error instanceof ImportError) {
          jobLog.warn({ reason: error.message }, "import failed (terminal)");
          await failImportCapture(pool, payload, error);
        } else {
          throw error;
        }
      }
      await completeJob(pool, job.id);
    } else {
      jobLog.warn("unknown job type; marking dead");
      await failJob(pool, { ...job, attempts: job.max_attempts }, "unknown job type");
    }
  } catch (error) {
    jobLog.error({ err: error }, "job failed; scheduling retry");
    await failJob(pool, job, (error as Error).message);
  }
  return true;
}
