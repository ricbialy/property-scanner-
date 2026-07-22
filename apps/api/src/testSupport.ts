import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { loadEnv } from "@propertyscan/config";
import { createTestDatabase } from "@propertyscan/database/dist/testing.js";
import { createFsStorage, type ObjectStorage } from "@propertyscan/storage";
import { createDevVerifier } from "@propertyscan/auth";
import type pg from "pg";

import { buildServer } from "./server.js";

export interface TestApp {
  app: FastifyInstance;
  pool: pg.Pool;
  storage: ObjectStorage;
  teardown: () => Promise<void>;
}

/** Build a fully wired API against a throwaway database and temp fs storage. */
export async function createTestApp(): Promise<TestApp> {
  const { pool, teardown: dropDb } = await createTestDatabase();
  const storageRoot = await mkdtemp(join(tmpdir(), "ps-api-test-"));
  const env = loadEnv({
    APP_ENV: "test",
    DATABASE_URL: "postgres://unused-in-tests/only-pool-is-real",
    WEBHOOK_MASTER_ENCRYPTION_KEY: "dev-only-not-a-real-key-0000000000000000",
    STORAGE_FS_ROOT: storageRoot
  });
  const storage = createFsStorage(storageRoot);
  const app = buildServer({
    env,
    pool,
    storage,
    verifier: createDevVerifier()
  });
  return {
    app,
    pool,
    storage,
    teardown: async () => {
      await app.close();
      await dropDb();
    }
  };
}

export const asUser = (userId: string, organizationId?: string) => ({
  authorization: `Bearer dev_${userId}`,
  ...(organizationId ? { "x-organization-id": organizationId } : {})
});
