import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  completeMediaUploadRequestSchema,
  createMediaLinkRequestSchema,
  createMediaUploadRequestSchema
} from "@propertyscan/contracts";
import {
  createMediaLink,
  createMediaUpload,
  findMediaById,
  listMediaForSubject,
  markMediaReady,
  markMediaRejected,
  recordAuditEvent,
  type MediaRow
} from "@propertyscan/database";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { sendProblem, sendValidationProblem } from "../problems.js";
import { jpegDimensions, pngDimensions, sniffImageType, stripJpegExif } from "../lib/imageMeta.js";

const UPLOAD_URL_TTL_SECONDS = 30 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

function serializeMedia(row: MediaRow) {
  return {
    id: row.id,
    contentType: row.mime_type,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    sha256: row.sha256,
    widthPx: row.width_px,
    heightPx: row.height_px,
    capturedAt: row.captured_at?.toISOString() ?? null,
    exifPolicy: row.exif_policy,
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

export function registerMediaRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/v1/media/uploads", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const parsed = createMediaUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    if (parsed.data.byteSize > MEDIA_MAX_BYTES) {
      return sendProblem(reply, 413, "Media exceeds size limit");
    }
    const media = await createMediaUpload(deps.pool, tenant.organizationId, {
      // Key chosen server-side; the real key gains the media id after insert,
      // so create first with a placeholder then derive.
      objectKey: "pending",
      mimeType: parsed.data.contentType,
      ...(parsed.data.capturedAt ? { capturedAt: new Date(parsed.data.capturedAt) } : {})
    });
    const objectKey = `orgs/${tenant.organizationId}/media/${media.id}/original`;
    await deps.pool.query("update media set object_key = $1 where id = $2", [objectKey, media.id]);

    const presigned = await deps.storage.createUploadUrl(
      objectKey,
      parsed.data.contentType,
      UPLOAD_URL_TTL_SECONDS
    );
    return reply.status(201).send({
      mediaId: media.id,
      uploadUrl: presigned ?? `${deps.env.API_BASE_URL}/v1/media/uploads/${media.id}/content`,
      objectKey,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString()
    });
  });

  // Local-driver byte target (fs storage only).
  app.put("/v1/media/uploads/:mediaId/content", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { mediaId } = request.params as { mediaId: string };
    const media = await findMediaById(deps.pool, tenant.organizationId, mediaId);
    if (!media || media.status !== "pending") {
      return sendProblem(reply, 404, "Media upload not found");
    }
    const body = request.body;
    if (!(body instanceof Buffer) || body.byteLength === 0) {
      return sendProblem(reply, 400, "Binary request body required");
    }
    if (body.byteLength > MEDIA_MAX_BYTES) {
      return sendProblem(reply, 413, "Media exceeds size limit");
    }
    await deps.storage.put(media.object_key, new Uint8Array(body), media.mime_type);
    return reply.status(204).send();
  });

  /**
   * Validate and finalize: checksum, MIME signature vs declared type, pixel
   * dimensions, and metadata policy (JPEG Exif APP1 removed before the object
   * is considered ready; HEIC deferred to the processing worker).
   */
  app.post("/v1/media/uploads/:mediaId/complete", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { mediaId } = request.params as { mediaId: string };
    const parsed = completeMediaUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const media = await findMediaById(deps.pool, tenant.organizationId, mediaId);
    if (!media || media.status !== "pending") {
      return sendProblem(reply, 404, "Media upload not found");
    }
    if (!(await deps.storage.exists(media.object_key))) {
      return sendProblem(reply, 409, "Media bytes have not been uploaded");
    }
    const stored = await deps.storage.get(media.object_key);
    const digest = createHash("sha256").update(stored).digest("hex");
    if (digest !== parsed.data.sha256 || stored.byteLength !== parsed.data.byteSize) {
      return sendProblem(reply, 422, "Checksum mismatch");
    }

    const sniffed = sniffImageType(stored);
    if (sniffed !== media.mime_type) {
      await markMediaRejected(deps.pool, tenant.organizationId, mediaId);
      return sendProblem(
        reply,
        422,
        "Content does not match declared type",
        `Declared ${media.mime_type}, detected ${sniffed}`
      );
    }

    let finalBytes = stored;
    let exifPolicy: string;
    if (sniffed === "image/jpeg") {
      const stripResult = stripJpegExif(stored);
      finalBytes = stripResult.data;
      exifPolicy = stripResult.strippedSegments > 0 ? "exif_app1_stripped" : "no_exif_found";
      if (stripResult.strippedSegments > 0) {
        await deps.storage.put(media.object_key, finalBytes, media.mime_type);
      }
    } else if (sniffed === "image/png") {
      exifPolicy = "not_applicable";
    } else {
      // HEIC: metadata handling needs a real image toolchain (worker, later).
      exifPolicy = "unstripped_pending";
    }

    const dims =
      sniffed === "image/jpeg"
        ? jpegDimensions(finalBytes)
        : sniffed === "image/png"
          ? pngDimensions(finalBytes)
          : null;

    const storedDigest = createHash("sha256").update(finalBytes).digest("hex");
    const updated = await markMediaReady(deps.pool, tenant.organizationId, mediaId, {
      sha256: storedDigest,
      byteSize: finalBytes.byteLength,
      widthPx: dims?.widthPx ?? null,
      heightPx: dims?.heightPx ?? null,
      exifPolicy
    });
    await recordAuditEvent(deps.pool, {
      organizationId: tenant.organizationId,
      actorType: "user",
      actorId: tenant.userId,
      action: "media.uploaded",
      subjectType: "media",
      subjectId: mediaId,
      metadata: { contentType: media.mime_type, exifPolicy }
    });
    return serializeMedia(updated!);
  });

  // Authorized download: presigned redirect (s3) or direct stream (fs).
  app.get("/v1/media/:mediaId/content", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { mediaId } = request.params as { mediaId: string };
    const media = await findMediaById(deps.pool, tenant.organizationId, mediaId);
    if (!media || media.status !== "ready") {
      return sendProblem(reply, 404, "Media not found");
    }
    const signed = await deps.storage.createDownloadUrl(media.object_key, DOWNLOAD_URL_TTL_SECONDS);
    if (signed) {
      return reply.redirect(signed, 302);
    }
    const bytes = await deps.storage.get(media.object_key);
    return reply.header("content-type", media.mime_type).send(Buffer.from(bytes));
  });

  // Spec §9.2: link opening photos. The opening must exist in this tenant's
  // relational projection; ordering is the client-managed position.
  app.post("/v1/openings/:openingId/media-links", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { openingId } = request.params as { openingId: string };
    const parsed = createMediaLinkRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    // Payload opening ids are the stable identity; relational rows from
    // corrected revisions carry them as sourceId in source_metadata.
    const opening = await deps.pool.query(
      `select id from openings
       where organization_id = $2 and (id::text = $1 or source_metadata->>'sourceId' = $1)
       limit 1`,
      [openingId, tenant.organizationId]
    );
    if (opening.rows.length === 0) {
      return sendProblem(reply, 404, "Opening not found");
    }
    const media = await findMediaById(deps.pool, tenant.organizationId, parsed.data.mediaId);
    if (!media || media.status !== "ready") {
      return sendProblem(reply, 404, "Media not found or not ready");
    }
    const link = await createMediaLink(deps.pool, tenant.organizationId, {
      mediaId: parsed.data.mediaId,
      subjectType: "opening",
      subjectId: openingId,
      position: parsed.data.position
    });
    return reply.status(201).send({
      id: link.id,
      mediaId: link.media_id,
      subjectType: link.subject_type,
      subjectId: link.subject_id,
      position: link.position
    });
  });

  app.get("/v1/openings/:openingId/media-links", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { openingId } = request.params as { openingId: string };
    const items = await listMediaForSubject(deps.pool, tenant.organizationId, "opening", openingId);
    const data = [];
    for (const item of items) {
      const signed = await deps.storage.createDownloadUrl(
        item.object_key,
        DOWNLOAD_URL_TTL_SECONDS
      );
      data.push({
        ...serializeMedia(item),
        position: item.position,
        downloadUrl: signed ?? `${deps.env.API_BASE_URL}/v1/media/${item.id}/content`
      });
    }
    return { data };
  });
}
