import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type pg from "pg";

/**
 * Forward-only SQL migration runner. Files in `migrations/` named
 * NNNN_description.sql are applied in lexical order, each inside a transaction,
 * and recorded in schema_migrations. Applying is idempotent.
 */
export async function migrate(
  pool: pg.Pool,
  migrationsDir: string
): Promise<{ applied: string[] }> {
  await pool.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    const { rows } = await pool.query("select 1 from schema_migrations where name = $1", [file]);
    if (rows.length > 0) {
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return { applied };
}
