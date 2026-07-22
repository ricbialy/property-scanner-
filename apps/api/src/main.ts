import { loadEnv } from "@propertyscan/config";
import { createPool } from "@propertyscan/database";
import { createStorage } from "@propertyscan/storage";
import { createVerifier } from "@propertyscan/auth";

import { buildServer } from "./server.js";

const env = loadEnv();
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
const verifier = createVerifier({
  authMode: env.AUTH_MODE,
  clerkIssuer: env.CLERK_JWT_ISSUER
});

const app = buildServer({ env, pool, storage, verifier });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
