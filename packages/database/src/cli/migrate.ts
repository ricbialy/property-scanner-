import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { migrate } from "../migrate.js";
import { createPool } from "../pool.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const pool = createPool(databaseUrl);

try {
  const { applied } = await migrate(pool, migrationsDir);
  console.error(
    applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date"
  );
} finally {
  await pool.end();
}
