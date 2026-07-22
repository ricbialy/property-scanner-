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
  issueHandoffToken,
  markCaptureArtifactUploaded,
  recordAuditEvent,
  redeemHandoffToken,
  transitionScanSession,
  withTransaction,
  type ScanSessionRow
} from "@propertyscan/database";
import { z } from "zod";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { withIdempotency } from "../plugins/idempotency.js";
import { sendProblem, sendValidationProblem } from "../problems.js";

const HANDOFF_TTL_SECONDS = 15 * 60;
const UPLOAD_URL_TTL_SECONDS = 30 * 60;

function serializeScanSession(row: ScanSessionRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    floorId: row.floor_id,
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
      contentType: parsed.data.contentType
    });
    const presigned = await deps.storage.createUploadUrl(
      objectKey,
      parsed.data.contentType,
      UPLOAD_URL_TTL_SECONDS
    );
    const uploadUrl =
      presigned ??
      `${deps.env.API_BASE_URL}/v1/scan-sessions/${scanSessionId}/uploads/${artifact.id}/content`;
    return reply.status(201).send({
      uploadId: artifact.id,
      uploadUrl,
      objectKey,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString()
    });
  });

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
