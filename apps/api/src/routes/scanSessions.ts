import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  completeUploadRequestSchema,
  createScanSessionRequestSchema,
  createUploadRequestSchema,
  scanSessionStatusSchema
} from "@propertyscan/contracts";
import {
  appendOutboxEvent,
  createImportRun,
  createOrGetCaptureArtifact,
  createScanSession,
  enqueueJob,
  findCaptureArtifact,
  findFloorById,
  findPropertyById,
  findScanSessionById,
  isEntitled,
  issueHandoffToken,
  listUploadParts,
  markCaptureArtifactUploaded,
  recordUploadPart,
  recordAuditEvent,
  redeemHandoffToken,
  transitionScanSession,
  withTransaction,
  type EntitlementKey,
  type ScanSessionRow
} from "@propertyscan/database";
import { z } from "zod";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { withIdempotency } from "../plugins/idempotency.js";
import { sendProblem, sendValidationProblem } from "../problems.js";

const HANDOFF_TTL_SECONDS = 15 * 60;

/** Part objects live beside the final bundle; assembled at completion. */
function partObjectKey(objectKey: string, partNumber: number): string {
  return `${objectKey}.part${String(partNumber).padStart(5, "0")}`;
}
const UPLOAD_URL_TTL_SECONDS = 30 * 60;

/**
 * Which parts the server holds. DB rows are written by the local part route,
 * but presigned (S3) uploads PUT part objects directly to storage and never
 * hit the API — so parts without a DB row are probed in object storage before
 * being declared missing.
 */
async function resolveUploadParts(
  deps: AppDeps,
  organizationId: string,
  artifact: { id: string; object_key: string; part_count: number }
): Promise<{ received: number[]; missing: number[] }> {
  const rows = await listUploadParts(deps.pool, organizationId, artifact.id);
  const present = new Set(rows.map((p) => p.part_number));
  const missing: number[] = [];
  for (let n = 1; n <= artifact.part_count; n += 1) {
    if (present.has(n)) continue;
    if (await deps.storage.exists(partObjectKey(artifact.object_key, n))) {
      present.add(n);
    } else {
      missing.push(n);
    }
  }
  return { received: [...present].sort((a, b) => a - b), missing };
}

function serializeScanSession(row: ScanSessionRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    floorId: row.floor_id,
    captureMode: row.capture_mode,
    status: row.status,
    requestedOutputs: row.requested_outputs,
    externalReferences: row.external_references,
    planId: row.plan_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function registerScanSessionRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/v1/scan-sessions", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const parsed = createScanSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    // Capture-mode entitlement is enforced server-side (amendment §15).
    // interior_roomplan is on by default; exterior/verification modes stay
    // disabled until their acceptance gates are satisfied.
    const modeEntitlement: Record<string, EntitlementKey> = {
      interior_roomplan: "interior_capture",
      exterior_facade: "exterior_capture",
      opening_verification: "opening_verification"
    };
    const requiredEntitlement = modeEntitlement[parsed.data.captureMode]!;
    if (!(await isEntitled(deps.pool, tenant.organizationId, requiredEntitlement))) {
      return sendProblem(
        reply,
        403,
        "Capture mode not enabled",
        `This organization is not entitled to '${parsed.data.captureMode}' capture`
      );
    }
    await withIdempotency(
      deps,
      request,
      reply,
      "POST /v1/scan-sessions",
      tenant.organizationId,
      async () => {
        const property = await findPropertyById(
          deps.pool,
          tenant.organizationId,
          parsed.data.propertyId
        );
        if (!property) {
          return { status: 404, body: { title: "Property not found", status: 404 } };
        }
        const floor = await findFloorById(deps.pool, tenant.organizationId, parsed.data.floorId);
        if (!floor || floor.property_id !== property.id) {
          return { status: 404, body: { title: "Floor not found", status: 404 } };
        }
        const session = await createScanSession(deps.pool, tenant.organizationId, {
          propertyId: parsed.data.propertyId,
          floorId: parsed.data.floorId,
          captureMode: parsed.data.captureMode,
          requestedOutputs: parsed.data.requestedOutputs,
          externalReferences: parsed.data.externalReferences ?? []
        });
        await recordAuditEvent(deps.pool, {
          organizationId: tenant.organizationId,
          actorType: "user",
          actorId: tenant.userId,
          action: "scan_session.created",
          subjectType: "scan_session",
          subjectId: session.id
        });
        return { status: 201, body: serializeScanSession(session) };
      }
    );
    return undefined;
  });

  app.get("/v1/scan-sessions/:scanSessionId", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { scanSessionId } = request.params as { scanSessionId: string };
    const session = await findScanSessionById(deps.pool, tenant.organizationId, scanSessionId);
    if (!session) {
      return sendProblem(reply, 404, "Scan session not found");
    }
    return serializeScanSession(session);
  });

  // Device-reported lifecycle transitions, validated against the state machine.
  app.post("/v1/scan-sessions/:scanSessionId/status", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { scanSessionId } = request.params as { scanSessionId: string };
    const bodySchema = z.object({
      from: scanSessionStatusSchema,
      to: scanSessionStatusSchema
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const session = await findScanSessionById(deps.pool, tenant.organizationId, scanSessionId);
    if (!session) {
      return sendProblem(reply, 404, "Scan session not found");
    }
    try {
      const updated = await transitionScanSession(
        deps.pool,
        tenant.organizationId,
        scanSessionId,
        parsed.data.from,
        parsed.data.to
      );
      if (!updated) {
        return sendProblem(
          reply,
          409,
          "Stale transition",
          `Session is no longer in status '${parsed.data.from}'`
        );
      }
      return serializeScanSession(updated);
    } catch (error) {
      return sendProblem(reply, 422, "Illegal transition", (error as Error).message);
    }
  });

  app.post("/v1/scan-sessions/:scanSessionId/handoff-token", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { scanSessionId } = request.params as { scanSessionId: string };
    const session = await findScanSessionById(deps.pool, tenant.organizationId, scanSessionId);
    if (!session) {
      return sendProblem(reply, 404, "Scan session not found");
    }
    const { token, row } = await issueHandoffToken(
      deps.pool,
      tenant.organizationId,
      scanSessionId,
      HANDOFF_TTL_SECONDS
    );
    await recordAuditEvent(deps.pool, {
      organizationId: tenant.organizationId,
      actorType: "user",
      actorId: tenant.userId,
      action: "scan_session.handoff_token_issued",
      subjectType: "scan_session",
      subjectId: scanSessionId
    });
    return reply.status(201).send({
      scanSessionId,
      token,
      deepLinkUrl: `propertyscan://scan?token=${encodeURIComponent(token)}`,
      browserFallbackUrl: `${deps.env.WEB_BASE_URL}/scan/handoff?token=${encodeURIComponent(token)}`,
      expiresAt: row.expires_at.toISOString()
    });
  });

  // Unauthenticated: the single-use, short-lived token IS the credential.
  // Returns capture-scoped metadata only — never tenant data or API credentials.
  app.post("/v1/scan-handoff/redeem", async (request, reply) => {
    const parsed = z.object({ token: z.string().min(10).max(200) }).safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const redeemed = await redeemHandoffToken(deps.pool, parsed.data.token);
    if (!redeemed) {
      return sendProblem(reply, 404, "Handoff token invalid, expired, or already used");
    }
    const { rows } = await deps.pool.query(
      "select * from scan_sessions where id = $1 and organization_id = $2",
      [redeemed.scan_session_id, redeemed.organization_id]
    );
    const session = rows[0] as ScanSessionRow;
    return {
      scanSessionId: session.id,
      status: session.status,
      requestedOutputs: session.requested_outputs
    };
  });

  app.post("/v1/scan-sessions/:scanSessionId/uploads", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { scanSessionId } = request.params as { scanSessionId: string };
    const session = await findScanSessionById(deps.pool, tenant.organizationId, scanSessionId);
    if (!session) {
      return sendProblem(reply, 404, "Scan session not found");
    }
    const parsed = createUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    if (parsed.data.byteSize > deps.env.UPLOAD_MAX_BYTES) {
      return sendProblem(reply, 413, "Upload exceeds size limit");
    }
    // Server-chosen object key; idempotent per (session, captureId).
    const objectKey = `orgs/${tenant.organizationId}/scans/${scanSessionId}/captures/${parsed.data.captureId}/bundle.zip`;
    const artifact = await createOrGetCaptureArtifact(deps.pool, tenant.organizationId, {
      scanSessionId,
      captureId: parsed.data.captureId,
      objectKey,
      contentType: parsed.data.contentType,
      partCount: parsed.data.partCount
    });

    const localBase = `${deps.env.API_BASE_URL}/v1/scan-sessions/${scanSessionId}/uploads/${artifact.id}`;
    const partCount = artifact.part_count;
    let uploadUrl: string | null = null;
    const partUploadUrls: Array<{ partNumber: number; uploadUrl: string }> = [];
    if (partCount === 1) {
      const presigned = await deps.storage.createUploadUrl(
        objectKey,
        parsed.data.contentType,
        UPLOAD_URL_TTL_SECONDS
      );
      uploadUrl = presigned ?? `${localBase}/content`;
    } else {
      for (let n = 1; n <= partCount; n += 1) {
        const presigned = await deps.storage.createUploadUrl(
          partObjectKey(objectKey, n),
          "application/octet-stream",
          UPLOAD_URL_TTL_SECONDS
        );
        partUploadUrls.push({ partNumber: n, uploadUrl: presigned ?? `${localBase}/parts/${n}` });
      }
    }
    return reply.status(201).send({
      uploadId: artifact.id,
      uploadUrl,
      partCount,
      partUploadUrls,
      objectKey,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString()
    });
  });

  // Resume support: which parts the server already holds.
  app.get("/v1/scan-sessions/:scanSessionId/uploads/:uploadId", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { scanSessionId, uploadId } = request.params as {
      scanSessionId: string;
      uploadId: string;
    };
    const artifact = await findCaptureArtifact(deps.pool, tenant.organizationId, uploadId);
    if (!artifact || artifact.scan_session_id !== scanSessionId) {
      return sendProblem(reply, 404, "Upload not found");
    }
    const { received, missing } = await resolveUploadParts(deps, tenant.organizationId, artifact);
    return {
      uploadId: artifact.id,
      status: artifact.status,
      partCount: artifact.part_count,
      receivedParts: received,
      missingParts: missing
    };
  });

  // Local-driver chunk target (fs storage only). S3 deployments PUT to the
  // presigned per-part URLs; the part record is created at completion for them.
  app.put(
    "/v1/scan-sessions/:scanSessionId/uploads/:uploadId/parts/:partNumber",
    async (request, reply) => {
      const tenant = await requireTenant(deps, request, reply, "member");
      if (!tenant) return;
      const { scanSessionId, uploadId, partNumber } = request.params as {
        scanSessionId: string;
        uploadId: string;
        partNumber: string;
      };
      const n = Number(partNumber);
      const artifact = await findCaptureArtifact(deps.pool, tenant.organizationId, uploadId);
      if (!artifact || artifact.scan_session_id !== scanSessionId) {
        return sendProblem(reply, 404, "Upload not found");
      }
      if (!Number.isInteger(n) || n < 1 || n > artifact.part_count) {
        return sendProblem(reply, 400, "Invalid part number");
      }
      const body = request.body;
      if (!(body instanceof Buffer) || body.byteLength === 0) {
        return sendProblem(reply, 400, "Binary request body required");
      }
      const sha256 = createHash("sha256").update(body).digest("hex");
      await deps.storage.put(
        partObjectKey(artifact.object_key, n),
        new Uint8Array(body),
        "application/octet-stream"
      );
      await recordUploadPart(deps.pool, tenant.organizationId, {
        captureArtifactId: artifact.id,
        partNumber: n,
        byteSize: body.byteLength,
        sha256
      });
      return reply.status(204).send();
    }
  );

  // Local-driver upload target (fs storage only). S3 deployments upload to the
  // presigned URL instead and never hit this route.
  app.put("/v1/scan-sessions/:scanSessionId/uploads/:uploadId/content", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { scanSessionId, uploadId } = request.params as {
      scanSessionId: string;
      uploadId: string;
    };
    const artifact = await findCaptureArtifact(deps.pool, tenant.organizationId, uploadId);
    if (!artifact || artifact.scan_session_id !== scanSessionId) {
      return sendProblem(reply, 404, "Upload not found");
    }
    const body = request.body;
    if (!(body instanceof Buffer) || body.byteLength === 0) {
      return sendProblem(reply, 400, "Binary request body required");
    }
    await deps.storage.put(artifact.object_key, new Uint8Array(body), artifact.content_type);
    return reply.status(204).send();
  });

  app.post(
    "/v1/scan-sessions/:scanSessionId/uploads/:uploadId/complete",
    async (request, reply) => {
      const tenant = await requireTenant(deps, request, reply, "member");
      if (!tenant) return;
      const { scanSessionId, uploadId } = request.params as {
        scanSessionId: string;
        uploadId: string;
      };
      const parsed = completeUploadRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationProblem(reply, parsed.error);
      }
      const artifact = await findCaptureArtifact(deps.pool, tenant.organizationId, uploadId);
      if (!artifact || artifact.scan_session_id !== scanSessionId) {
        return sendProblem(reply, 404, "Upload not found");
      }

      // Chunked upload: verify every part is present, then assemble the final
      // bundle object from the part objects before checksum verification.
      if (artifact.part_count > 1 && !(await deps.storage.exists(artifact.object_key))) {
        const parts = await listUploadParts(deps.pool, tenant.organizationId, uploadId);
        const byNumber = new Map(parts.map((p) => [p.part_number, p]));
        const { missing } = await resolveUploadParts(deps, tenant.organizationId, artifact);
        if (missing.length > 0) {
          return sendProblem(
            reply,
            409,
            "Upload incomplete",
            `Missing parts: ${missing.join(", ")}`,
            { missingParts: missing }
          );
        }
        const buffers: Uint8Array[] = [];
        for (let n = 1; n <= artifact.part_count; n += 1) {
          const key = partObjectKey(artifact.object_key, n);
          if (!(await deps.storage.exists(key))) {
            return sendProblem(reply, 409, "Upload incomplete", `Part ${n} bytes are missing`);
          }
          const data = await deps.storage.get(key);
          buffers.push(data);
          // Presigned uploads bypass the local part route, so their part
          // records are created here at completion (matching the audit trail
          // the local driver builds incrementally).
          if (!byNumber.has(n)) {
            await recordUploadPart(deps.pool, tenant.organizationId, {
              captureArtifactId: artifact.id,
              partNumber: n,
              byteSize: data.byteLength,
              sha256: createHash("sha256").update(data).digest("hex")
            });
          }
        }
        const assembled = Buffer.concat(buffers.map((b) => Buffer.from(b)));
        await deps.storage.put(
          artifact.object_key,
          new Uint8Array(assembled),
          artifact.content_type
        );
      }

      if (!(await deps.storage.exists(artifact.object_key))) {
        return sendProblem(reply, 409, "Bundle bytes have not been uploaded");
      }
      const stored = await deps.storage.get(artifact.object_key);
      const digest = createHash("sha256").update(stored).digest("hex");
      if (digest !== parsed.data.sha256 || stored.byteLength !== parsed.data.byteSize) {
        return sendProblem(
          reply,
          422,
          "Checksum mismatch",
          "Stored bundle does not match the declared SHA-256/byte size"
        );
      }
      const updated = await markCaptureArtifactUploaded(
        deps.pool,
        tenant.organizationId,
        uploadId,
        {
          sha256: parsed.data.sha256,
          byteSize: parsed.data.byteSize
        }
      );
      return { uploadId: updated!.id, status: updated!.status };
    }
  );

  app.post("/v1/scan-sessions/:scanSessionId/complete", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { scanSessionId } = request.params as { scanSessionId: string };
    const session = await findScanSessionById(deps.pool, tenant.organizationId, scanSessionId);
    if (!session) {
      return sendProblem(reply, 404, "Scan session not found");
    }
    if (session.status !== "uploading") {
      return sendProblem(
        reply,
        409,
        "Scan session not ready to complete",
        `Expected status 'uploading', found '${session.status}'`
      );
    }
    const { rows } = await deps.pool.query(
      "select * from capture_artifacts where scan_session_id = $1 and organization_id = $2 and status = 'uploaded' order by created_at desc limit 1",
      [scanSessionId, tenant.organizationId]
    );
    const artifact = rows[0] as { id: string; sha256: string | null } | undefined;
    if (!artifact) {
      return sendProblem(reply, 409, "No verified uploaded bundle for this session");
    }

    const result = await withTransaction(deps.pool, async (tx) => {
      const updated = await transitionScanSession(
        tx,
        tenant.organizationId,
        scanSessionId,
        "uploading",
        "processing"
      );
      if (!updated) {
        return null;
      }
      const importRun = await createImportRun(tx, tenant.organizationId, {
        scanSessionId,
        captureArtifactId: artifact.id
      });
      // Job key ties idempotency to the exact bundle content.
      await enqueueJob(tx, {
        jobKey: `import:${scanSessionId}:${artifact.sha256 ?? artifact.id}`,
        jobType: "import_capture",
        payload: {
          importRunId: importRun.id,
          organizationId: tenant.organizationId,
          scanSessionId,
          captureArtifactId: artifact.id
        }
      });
      await appendOutboxEvent(tx, {
        organizationId: tenant.organizationId,
        eventType: "scan.processing",
        resourceType: "scan_session",
        resourceId: scanSessionId,
        payload: { scanSessionId, importRunId: importRun.id }
      });
      return { updated, importRun };
    });
    if (!result) {
      return sendProblem(reply, 409, "Scan session state changed concurrently");
    }
    return {
      ...serializeScanSession(result.updated),
      importRunId: result.importRun.id
    };
  });
}
