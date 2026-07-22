import { hostname } from "node:os";

import { loadEnv } from "@propertyscan/config";
import { createPool } from "@propertyscan/database";
import { createLogger } from "@propertyscan/observability";
import { createStorage } from "@propertyscan/storage";

import { tick, type WorkerDeps } from "./worker.js";

const env = loadEnv();
const log = createLogger("worker");
const pool = createPool(env.DATABASE_URL);
const storage = createStorage(
  env.STORAGE_DRIVER === "s3"
    ? {
        driver: "s3",
        s3: {
          endpoint: env.S3_ENDPOINT!,
          region: env.S3_REGION!,
          bucket: env.S3_BUCKET!,
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!
        }
      }
    : { driver: "fs", fsRoot: env.STORAGE_FS_ROOT }
);

const deps: WorkerDeps = {
  pool,
  storage,
  log,
  workerId: `worker-${hostname()}-${process.pid}`
};

const POLL_INTERVAL_MS = 1000;
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

log.info({ workerId: deps.workerId }, "worker started");
while (running) {
  const didWork = await tick(deps);
  if (!didWork) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
await pool.end();
log.info("worker stopped");
