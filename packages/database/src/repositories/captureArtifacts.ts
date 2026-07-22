import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface CaptureArtifactRow {
  id: string;
  organization_id: string;
  scan_session_id: string;
  capture_id: string;
  object_key: string;
  byte_size: string | number | null;
  sha256: string | null;
  content_type: string;
  status: "pending" | "uploaded" | "verified" | "rejected";
}

/**
 * Register an upload slot. Idempotent per (scanSessionId, captureId): retrying
 * the same capture returns the existing artifact instead of a new object key.
 */
export async function createOrGetCaptureArtifact(
  db: Queryable,
  organizationId: string,
  input: { scanSessionId: string; captureId: string; objectKey: string; contentType: string }
): Promise<CaptureArtifactRow> {
  const { rows } = await db.query(
    `insert into capture_artifacts (id, organization_id, scan_session_id, capture_id, object_key, content_type)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (scan_session_id, capture_id) do update set updated_at = now()
     returning *`,
    [
      uuidv7(),
      organizationId,
      input.scanSessionId,
      input.captureId,
      input.objectKey,
      input.contentType
    ]
  );
  return rows[0] as CaptureArtifactRow;
}

export async function findCaptureArtifact(
  db: Queryable,
  organizationId: string,
  artifactId: string
): Promise<CaptureArtifactRow | null> {
  const { rows } = await db.query(
    "select * from capture_artifacts where id = $1 and organization_id = $2",
    [artifactId, organizationId]
  );
  return (rows[0] as CaptureArtifactRow | undefined) ?? null;
}

export async function markCaptureArtifactUploaded(
  db: Queryable,
  organizationId: string,
  artifactId: string,
  input: { sha256: string; byteSize: number }
): Promise<CaptureArtifactRow | null> {
  const { rows } = await db.query(
    `update capture_artifacts
     set status = 'uploaded', sha256 = $1, byte_size = $2, updated_at = now()
     where id = $3 and organization_id = $4
     returning *`,
    [input.sha256, input.byteSize, artifactId, organizationId]
  );
  return (rows[0] as CaptureArtifactRow | undefined) ?? null;
}
