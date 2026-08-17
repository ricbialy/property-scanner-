import { createHash } from "node:crypto";

import { unzipSync } from "fflate";
import {
  captureManifestSchema,
  GEOMETRY_SCHEMA_VERSION,
  NOT_PROCESSED,
  type PlanRevisionPayload,
  type ValidationFinding
} from "@propertyscan/contracts";
import { transformSanity } from "@propertyscan/geometry";
import {
  appendOutboxEvent,
  createPlanWithInitialRevision,
  finishImportRun,
  insertOpeningRecord,
  insertRoomRecord,
  insertWallRecord,
  startImportRun,
  transitionScanSession,
  withTransaction
} from "@propertyscan/database";
import type { ObjectStorage } from "@propertyscan/storage";
import type pg from "pg";

import { roomplanRoomSchema, roomplanStructureSchema } from "./roomplanAdapter.js";
import { normalizeGeometry, type RoomToNormalize } from "./normalizeGeometry.js";

export interface ImportJobPayload {
  importRunId: string;
  organizationId: string;
  scanSessionId: string;
  captureArtifactId: string;
}

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly findings: ValidationFinding[] = []
  ) {
    super(message);
    this.name = "ImportError";
  }
}

// Malformed bytes in a user-uploaded bundle are a terminal import failure, not
// an infrastructure error — throwing a plain SyntaxError here would send the
// job into retry/dead-letter and leave the session stuck in 'processing'.
function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/**
 * Import pipeline (spec §9.4, current milestone scope):
 * verify manifest + checksums, preserve raw artifacts immutably, parse RoomPlan
 * JSON through a version-tolerant adapter, emit quality findings, and create the
 * initial immutable plan revision transactionally. Geometry that is not yet
 * normalized is explicitly `not_processed` — never invented.
 */
export async function processImportCapture(
  pool: pg.Pool,
  storage: ObjectStorage,
  payload: ImportJobPayload
): Promise<{ planId: string; revisionId: string }> {
  const { organizationId, scanSessionId, importRunId } = payload;
  await startImportRun(pool, importRunId);

  const { rows } = await pool.query(
    "select * from capture_artifacts where id = $1 and organization_id = $2",
    [payload.captureArtifactId, organizationId]
  );
  const artifact = rows[0] as
    { object_key: string; sha256: string | null; status: string } | undefined;
  if (!artifact) {
    throw new ImportError("capture artifact not found");
  }
  if (artifact.status !== "uploaded") {
    throw new ImportError(`capture artifact in unexpected status '${artifact.status}'`);
  }

  const bundleBytes = await storage.get(artifact.object_key);
  if (artifact.sha256) {
    const digest = createHash("sha256").update(bundleBytes).digest("hex");
    if (digest !== artifact.sha256) {
      throw new ImportError("stored bundle no longer matches its recorded checksum");
    }
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bundleBytes);
  } catch {
    throw new ImportError("bundle is not a readable zip archive");
  }
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) {
    throw new ImportError("bundle is missing manifest.json");
  }

  let manifestJson: unknown;
  try {
    manifestJson = decodeJson(manifestBytes);
  } catch {
    throw new ImportError("manifest.json is not valid JSON");
  }
  const manifestParse = captureManifestSchema.safeParse(manifestJson);
  if (!manifestParse.success) {
    throw new ImportError(
      "manifest failed schema validation",
      manifestParse.error.issues.map((issue) => ({
        code: "manifest_invalid",
        severity: "error" as const,
        message: `${issue.path.join(".")}: ${issue.message}`
      }))
    );
  }
  const manifest = manifestParse.data;
  if (manifest.scanSessionId !== scanSessionId) {
    throw new ImportError("manifest scanSessionId does not match the session being imported");
  }

  const findings: ValidationFinding[] = [];

  // Verify every declared file's checksum and size against the actual bytes.
  for (const file of manifest.files) {
    const data = entries[file.path];
    if (!data) {
      throw new ImportError(`bundle is missing declared file ${file.path}`);
    }
    const digest = createHash("sha256").update(data).digest("hex");
    if (digest !== file.sha256 || data.byteLength !== file.byteSize) {
      throw new ImportError(`checksum mismatch for ${file.path}`);
    }
  }

  // Preserve raw artifacts as immutable objects alongside the bundle.
  const rawPrefix = `orgs/${organizationId}/scans/${scanSessionId}/captures/${manifest.captureId}/raw`;
  for (const file of manifest.files) {
    const key = `${rawPrefix}/${file.path}`;
    if (!(await storage.exists(key))) {
      await storage.put(key, entries[file.path]!, file.contentType);
    }
  }

  // Parse each room through the adapter.
  const roomInputs: RoomToNormalize[] = [];
  for (const room of manifest.rooms) {
    let roomJson: unknown;
    try {
      const bytes = entries[room.roomplanFile];
      if (!bytes) throw new Error("file missing from bundle");
      roomJson = decodeJson(bytes);
    } catch (error) {
      findings.push({
        code: "roomplan_room_unreadable",
        severity: "error",
        message: `room ${room.roomId}: ${(error as Error).message}`,
        subjectType: "room",
        subjectId: room.roomId
      });
      continue;
    }
    const parse = roomplanRoomSchema.safeParse(roomJson);
    if (!parse.success) {
      findings.push({
        code: "roomplan_room_unreadable",
        severity: "error",
        message: `room ${room.roomId}: ${parse.error.issues[0]?.message ?? "unreadable"}`,
        subjectType: "room",
        subjectId: room.roomId
      });
      continue;
    }
    const captured = parse.data;
    if (captured.identifier.toLowerCase() !== room.roomId.toLowerCase()) {
      findings.push({
        code: "room_identifier_mismatch",
        severity: "warning",
        message: `manifest room ${room.roomId} contains capture ${captured.identifier}`,
        subjectType: "room",
        subjectId: room.roomId
      });
    }
    if (captured.walls.length < 3) {
      findings.push({
        code: "room_wall_count_low",
        severity: "warning",
        message: `room ${room.roomId} has only ${captured.walls.length} walls; closed-room reconstruction is unlikely`,
        subjectType: "room",
        subjectId: room.roomId
      });
    }
    for (const wall of captured.walls) {
      if (wall.transform) {
        const sanity = transformSanity(wall.transform);
        if (!sanity.ok) {
          findings.push({
            code: "wall_transform_insane",
            severity: "warning",
            message: `wall ${wall.identifier}: ${sanity.reasons.join(", ")}`,
            subjectType: "wall",
            subjectId: wall.identifier
          });
        }
      }
    }
    roomInputs.push({
      roomId: room.roomId,
      name: room.name ?? null,
      captured
    });
  }

  if (roomInputs.length === 0) {
    throw new ImportError("no readable rooms in bundle", findings);
  }

  // Multiroom structure alignment: apply per-room world transforms when the
  // structure result is present and sane.
  if (manifest.structureFile) {
    let structureJson: unknown = null;
    try {
      const bytes = entries[manifest.structureFile];
      if (bytes) structureJson = decodeJson(bytes);
    } catch {
      // leave null: schema parse below fails and records the finding
    }
    const structureParse = roomplanStructureSchema.safeParse(structureJson);
    if (!structureParse.success) {
      findings.push({
        code: "structure_unreadable",
        severity: "warning",
        message: "structure.json failed schema validation; automatic alignment unavailable"
      });
    } else {
      for (const structRoom of structureParse.data.rooms) {
        const sanity = transformSanity(structRoom.transform);
        if (!sanity.ok) {
          findings.push({
            code: "structure_transform_insane",
            severity: "warning",
            message: `structure room ${structRoom.identifier}: ${sanity.reasons.join(", ")}`,
            subjectType: "room",
            subjectId: structRoom.identifier
          });
          continue;
        }
        const target = roomInputs.find(
          (r) => r.roomId.toLowerCase() === structRoom.identifier.toLowerCase()
        );
        if (target) {
          target.structureTransform = structRoom.transform;
        }
      }
    }
  } else {
    findings.push({
      code: "structure_missing",
      severity: "info",
      message: "bundle has no structure.json; multiroom alignment will require manual review"
    });
  }

  // Normalize surfaces into canonical 2D geometry. Whatever cannot be derived
  // stays explicitly not_processed with a finding.
  const normalized = normalizeGeometry(roomInputs);
  findings.push(...normalized.findings);

  // Create plan + immutable initial revision + relational projections,
  // transition the session, and append the outbox event in ONE transaction
  // (no webhook before durable commit).
  const result = await withTransaction(pool, async (tx) => {
    const { plan, revision } = await createPlanWithInitialRevision(tx, organizationId, {
      floorId: (await tx.query("select floor_id from scan_sessions where id = $1", [scanSessionId]))
        .rows[0].floor_id,
      scanSessionId,
      reason: `import of capture ${manifest.captureId}`,
      geometrySchemaVersion: GEOMETRY_SCHEMA_VERSION,
      buildPayload: (planId, revisionId): PlanRevisionPayload => ({
        schemaVersion: GEOMETRY_SCHEMA_VERSION,
        planId,
        revisionId,
        coordinateConventions: {
          units: "meters",
          plan: "x-z-projection",
          winding: "ccw",
          angles: "radians"
        },
        rooms: normalized.rooms,
        walls: normalized.walls,
        openings: normalized.openings,
        validationFindings: findings
      })
    });

    for (const room of revision.payload.rooms) {
      await insertRoomRecord(tx, organizationId, {
        id: room.id,
        planRevisionId: revision.id,
        sourceRoomId: room.sourceRoomId,
        name: room.name,
        confidence: room.confidence,
        boundary: room.boundary === NOT_PROCESSED ? null : room.boundary,
        areaM2: room.areaM2 === NOT_PROCESSED ? null : room.areaM2
      });
    }
    for (const wall of revision.payload.walls) {
      await insertWallRecord(tx, organizationId, { planRevisionId: revision.id, wall });
    }
    for (const opening of revision.payload.openings) {
      await insertOpeningRecord(tx, organizationId, { planRevisionId: revision.id, opening });
    }

    const transitioned = await transitionScanSession(
      tx,
      organizationId,
      scanSessionId,
      "processing",
      "needs_review",
      { planId: plan.id }
    );
    if (!transitioned) {
      throw new ImportError("scan session left 'processing' state during import");
    }

    await finishImportRun(tx, importRunId, { status: "succeeded", findings });
    await appendOutboxEvent(tx, {
      organizationId,
      eventType: "scan.needs_review",
      resourceType: "scan_session",
      resourceId: scanSessionId,
      payload: { scanSessionId, planId: plan.id, revisionId: revision.id }
    });
    return { planId: plan.id, revisionId: revision.id };
  });

  return result;
}

/** Mark the import failed and surface the reason to the user-visible session. */
export async function failImportCapture(
  pool: pg.Pool,
  payload: ImportJobPayload,
  error: ImportError | Error
): Promise<void> {
  const findings = error instanceof ImportError ? error.findings : [];
  await withTransaction(pool, async (tx) => {
    await finishImportRun(tx, payload.importRunId, {
      status: "failed",
      findings,
      error: error.message
    });
    await transitionScanSession(
      tx,
      payload.organizationId,
      payload.scanSessionId,
      "processing",
      "failed",
      { failureReason: error.message }
    );
    await appendOutboxEvent(tx, {
      organizationId: payload.organizationId,
      eventType: "scan.failed",
      resourceType: "scan_session",
      resourceId: payload.scanSessionId,
      payload: { scanSessionId: payload.scanSessionId, reason: error.message }
    });
  });
}
