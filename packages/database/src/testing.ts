import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

/**
 * Integration-test helper: creates a throwaway database on the server pointed
 * at by TEST_DATABASE_URL (or DATABASE_URL), runs migrations, and returns a
 * pool plus a teardown that drops the database.
 */
export async function createTestDatabase(): Promise<{
  pool: pg.Pool;
  teardown: () => Promise<void>;
}> {
  const adminUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error("TEST_DATABASE_URL or DATABASE_URL must be set for integration tests");
  }
  const dbName = `propertyscan_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const pool = createPool(url.toString());
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  await migrate(pool, migrationsDir);

  return {
    pool,
    teardown: async () => {
      await pool.end();
      const cleaner = new pg.Client({ connectionString: adminUrl });
      await cleaner.connect();
      await cleaner.query(`drop database if exists ${dbName} with (force)`);
      await cleaner.end();
    }
  };
}
