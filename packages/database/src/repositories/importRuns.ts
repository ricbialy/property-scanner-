import type { ValidationFinding } from "@propertyscan/contracts";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface ImportRunRow {
  id: string;
  organization_id: string;
  scan_session_id: string;
  capture_artifact_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  findings: ValidationFinding[];
  error: string | null;
}

export async function createImportRun(
  db: Queryable,
  organizationId: string,
  input: { scanSessionId: string; captureArtifactId: string }
): Promise<ImportRunRow> {
  const { rows } = await db.query(
    `insert into import_runs (id, organization_id, scan_session_id, capture_artifact_id)
     values ($1, $2, $3, $4) returning *`,
    [uuidv7(), organizationId, input.scanSessionId, input.captureArtifactId]
  );
  return rows[0] as ImportRunRow;
}

export async function startImportRun(db: Queryable, importRunId: string): Promise<void> {
  await db.query(
    "update import_runs set status = 'running', started_at = now() where id = $1 and status = 'queued'",
    [importRunId]
  );
}

export async function finishImportRun(
  db: Queryable,
  importRunId: string,
  result: { status: "succeeded" | "failed"; findings: ValidationFinding[]; error?: string }
): Promise<void> {
  await db.query(
    `update import_runs
     set status = $1, findings = $2, error = $3, finished_at = now()
     where id = $4`,
    [result.status, JSON.stringify(result.findings), result.error ?? null, importRunId]
  );
}
