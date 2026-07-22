import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureBundle } from "@propertyscan/roomplan-fixtures";
import {
  createPlanWithInitialRevision,
  createScanSession,
  setEntitlement,
  withTransaction
} from "@propertyscan/database";
import { GEOMETRY_SCHEMA_VERSION, uuidSchema } from "@propertyscan/contracts";

import { asUser, createTestApp, type TestApp } from "./testSupport.js";
import { buildJpeg } from "./lib/imageFixtures.js";

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.teardown();
});

async function createOrg(userId: string, name: string): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: asUser(userId),
    payload: { name }
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function createPropertyAndFloor(
  userId: string,
  orgId: string
): Promise<{ propertyId: string; floorId: string }> {
  const propertyRes = await ctx.app.inject({
    method: "POST",
    url: "/v1/properties",
    headers: asUser(userId, orgId),
    payload: { name: "Test House" }
  });
  expect(propertyRes.statusCode).toBe(201);
  const propertyId = propertyRes.json().id;
  const floorRes = await ctx.app.inject({
    method: "POST",
    url: `/v1/properties/${propertyId}/floors`,
    headers: asUser(userId, orgId),
    payload: { name: "First Floor", ordinal: 0 }
  });
  expect(floorRes.statusCode).toBe(201);
  return { propertyId, floorId: floorRes.json().id };
}

describe("authentication", () => {
  it("returns 401 without a bearer token and problem+json content type", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/properties" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("serves health endpoints without auth", async () => {
    expect((await ctx.app.inject({ url: "/health/live" })).statusCode).toBe(200);
    expect((await ctx.app.inject({ url: "/health/ready" })).statusCode).toBe(200);
  });
});

describe("tenant isolation over HTTP", () => {
  it("prevents cross-tenant access even with valid IDs", async () => {
    const orgA = await createOrg("alice", "Alice Construction");
    const orgB = await createOrg("bob", "Bob Builders");
    const { propertyId } = await createPropertyAndFloor("alice", orgA);

    // Bob cannot select Alice's org via header.
    const viaHeader = await ctx.app.inject({
      method: "GET",
      url: `/v1/properties/${propertyId}`,
      headers: asUser("bob", orgA)
    });
    expect(viaHeader.statusCode).toBe(404);

    // Bob cannot reach Alice's property through his own org either.
    const viaOwnOrg = await ctx.app.inject({
      method: "GET",
      url: `/v1/properties/${propertyId}`,
      headers: asUser("bob", orgB)
    });
    expect(viaOwnOrg.statusCode).toBe(404);
  });
});

describe("scan session lifecycle", () => {
  it("creates sessions idempotently, hands off, uploads, and queues import", async () => {
    const orgId = await createOrg("carol", "Carol Renovations");
    const { propertyId, floorId } = await createPropertyAndFloor("carol", orgId);
    const headers = { ...asUser("carol", orgId), "idempotency-key": "create-session-1" };

    const createBody = { propertyId, floorId, requestedOutputs: ["normalized_json"] };
    const first = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers,
      payload: createBody
    });
    expect(first.statusCode).toBe(201);
    const sessionId = first.json().id;

    // Idempotent replay returns the same session.
    const replay = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers,
      payload: createBody
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(sessionId);

    // Same key, different body → 422.
    const conflict = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers,
      payload: { ...createBody, requestedOutputs: ["normalized_json", "pdf"] }
    });
    expect(conflict.statusCode).toBe(422);

    // Missing Idempotency-Key → 400.
    const missingKey = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers: asUser("carol", orgId),
      payload: createBody
    });
    expect(missingKey.statusCode).toBe(400);

    // Handoff token issue + single-use redeem without auth.
    const tokenRes = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/handoff-token`,
      headers: asUser("carol", orgId)
    });
    expect(tokenRes.statusCode).toBe(201);
    const { token, deepLinkUrl } = tokenRes.json();
    expect(deepLinkUrl).toContain("propertyscan://scan?token=");

    const redeem = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-handoff/redeem",
      payload: { token }
    });
    expect(redeem.statusCode).toBe(200);
    expect(redeem.json().scanSessionId).toBe(sessionId);
    const redeemAgain = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-handoff/redeem",
      payload: { token }
    });
    expect(redeemAgain.statusCode).toBe(404);

    // Walk the capture state machine as the device reports it.
    for (const [from, to] of [
      ["draft", "capturing"],
      ["capturing", "local_review"],
      ["local_review", "queued_upload"],
      ["queued_upload", "uploading"]
    ]) {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/v1/scan-sessions/${sessionId}/status`,
        headers: asUser("carol", orgId),
        payload: { from, to }
      });
      expect(res.statusCode).toBe(200);
    }

    // Illegal transition is rejected.
    const illegal = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/status`,
      headers: asUser("carol", orgId),
      payload: { from: "uploading", to: "completed" }
    });
    expect(illegal.statusCode).toBe(422);

    // Upload the fixture bundle.
    const { manifest, zip } = buildFixtureBundle(sessionId);
    const uploadRes = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads`,
      headers: asUser("carol", orgId),
      payload: {
        captureId: manifest.captureId,
        byteSize: zip.byteLength,
        contentType: "application/zip"
      }
    });
    expect(uploadRes.statusCode).toBe(201);
    const { uploadId, objectKey } = uploadRes.json();
    expect(objectKey.startsWith(`orgs/${orgId}/scans/${sessionId}/`)).toBe(true);

    // Retrying the same captureId returns the same upload slot.
    const uploadRetry = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads`,
      headers: asUser("carol", orgId),
      payload: {
        captureId: manifest.captureId,
        byteSize: zip.byteLength,
        contentType: "application/zip"
      }
    });
    expect(uploadRetry.json().uploadId).toBe(uploadId);

    // Completing before bytes exist fails.
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const early = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}/complete`,
      headers: asUser("carol", orgId),
      payload: { sha256, byteSize: zip.byteLength }
    });
    expect(early.statusCode).toBe(409);

    const putRes = await ctx.app.inject({
      method: "PUT",
      url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}/content`,
      headers: { ...asUser("carol", orgId), "content-type": "application/zip" },
      payload: Buffer.from(zip)
    });
    expect(putRes.statusCode).toBe(204);

    // Wrong checksum rejected.
    const badComplete = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}/complete`,
      headers: asUser("carol", orgId),
      payload: { sha256: "0".repeat(64), byteSize: zip.byteLength }
    });
    expect(badComplete.statusCode).toBe(422);

    const complete = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}/complete`,
      headers: asUser("carol", orgId),
      payload: { sha256, byteSize: zip.byteLength }
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe("uploaded");

    // Session completion enqueues exactly one import job (idempotent by content).
    const done = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/complete`,
      headers: asUser("carol", orgId)
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe("processing");
    expect(done.json().importRunId).toBeDefined();

    const jobs = await ctx.pool.query("select * from jobs where job_type = 'import_capture'");
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0].job_key).toBe(`import:${sessionId}:${sha256}`);
  });
});

describe("capture modes and entitlements", () => {
  it("defaults sessions to interior_roomplan (backwards compatible)", async () => {
    const orgId = await createOrg("gina", "Gina Interiors");
    const { propertyId, floorId } = await createPropertyAndFloor("gina", orgId);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers: { ...asUser("gina", orgId), "idempotency-key": "gina-1" },
      payload: { propertyId, floorId, requestedOutputs: ["normalized_json"] }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().captureMode).toBe("interior_roomplan");
  });

  it("refuses exterior_facade sessions without the entitlement, allows with it", async () => {
    const orgId = await createOrg("hank", "Hank Facades");
    const { propertyId, floorId } = await createPropertyAndFloor("hank", orgId);
    const body = {
      propertyId,
      floorId,
      captureMode: "exterior_facade",
      requestedOutputs: ["normalized_json"]
    };

    const denied = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers: { ...asUser("hank", orgId), "idempotency-key": "hank-1" },
      payload: body
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().title).toBe("Capture mode not enabled");

    await setEntitlement(ctx.pool, orgId, "exterior_capture", true, "test_admin");
    const allowed = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers: { ...asUser("hank", orgId), "idempotency-key": "hank-2" },
      payload: body
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().captureMode).toBe("exterior_facade");
  });

  it("gates facade endpoints behind exterior_capture", async () => {
    const orgId = await createOrg("iris", "Iris Builders");
    const { propertyId } = await createPropertyAndFloor("iris", orgId);
    const denied = await ctx.app.inject({
      method: "POST",
      url: `/v1/properties/${propertyId}/facades`,
      headers: asUser("iris", orgId),
      payload: { label: "Front" }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().title).toBe("Exterior capture not enabled");
  });
});

describe("exterior layer", () => {
  it("creates facades and openings, tenant-scoped", async () => {
    const orgId = await createOrg("dana", "Dana Exteriors");
    const otherOrg = await createOrg("evan", "Evan Roofing");
    await setEntitlement(ctx.pool, orgId, "exterior_capture", true, "test_admin");
    await setEntitlement(ctx.pool, otherOrg, "exterior_capture", true, "test_admin");
    const { propertyId } = await createPropertyAndFloor("dana", orgId);

    const facadeRes = await ctx.app.inject({
      method: "POST",
      url: `/v1/properties/${propertyId}/facades`,
      headers: asUser("dana", orgId),
      payload: { label: "Front", orientationDeg: 180 }
    });
    expect(facadeRes.statusCode).toBe(201);
    const facadeId = facadeRes.json().id;

    // Cross-tenant: Evan cannot see Dana's property facades.
    const crossList = await ctx.app.inject({
      method: "GET",
      url: `/v1/properties/${propertyId}/facades`,
      headers: asUser("evan", otherOrg)
    });
    expect(crossList.statusCode).toBe(404);

    const openingRes = await ctx.app.inject({
      method: "POST",
      url: `/v1/facades/${facadeId}/openings`,
      headers: asUser("dana", orgId),
      payload: { openingType: "window", label: "Front left window" }
    });
    expect(openingRes.statusCode).toBe(201);
    const opening = openingRes.json();
    expect(opening.verification).toBe("unverified");
    expect(opening.widthM).toBeNull();

    // Laser field-verified width updates the displayed dimension with provenance.
    const measurementRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/measurements",
      headers: asUser("dana", orgId),
      payload: {
        subjectType: "facade_opening",
        subjectId: opening.id,
        value: 1.219,
        unit: "m",
        semanticType: "width",
        source: "laser",
        fieldVerified: true
      }
    });
    expect(measurementRes.statusCode).toBe(201);
    expect(measurementRes.json().verification).toBe("field_verified");
    expect(measurementRes.json().capturedBy).toBe("dev_dana");

    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/v1/facades/${facadeId}/openings`,
      headers: asUser("dana", orgId)
    });
    const updated = listRes.json().data[0];
    expect(updated.widthM).toBeCloseTo(1.219);
    expect(updated.verification).toBe("field_verified");

    // Measurement history is preserved, not mutated.
    const history = await ctx.pool.query(
      "select * from measurements where subject_id = $1 order by created_at",
      [opening.id]
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].source).toBe("laser");

    // Cross-tenant measurement rejected.
    const crossMeasure = await ctx.app.inject({
      method: "POST",
      url: "/v1/measurements",
      headers: asUser("evan", otherOrg),
      payload: {
        subjectType: "facade_opening",
        subjectId: opening.id,
        value: 2,
        unit: "m",
        semanticType: "width",
        source: "manual"
      }
    });
    expect(crossMeasure.statusCode).toBe(404);
  });
});

describe("schedules", () => {
  it("serves window schedules with imperial display and disclaimer", async () => {
    const orgId = await createOrg("frank", "Frank Windows");
    const { propertyId, floorId } = await createPropertyAndFloor("frank", orgId);
    const session = await createScanSession(ctx.pool, orgId, {
      propertyId,
      floorId,
      requestedOutputs: ["normalized_json"],
      externalReferences: []
    });

    const roomId = "0198aaaa-0000-7000-8000-000000000001";
    const wallId = "0198aaaa-0000-7000-8000-000000000002";
    const { plan } = await withTransaction(ctx.pool, (tx) =>
      createPlanWithInitialRevision(tx, orgId, {
        floorId,
        scanSessionId: session.id,
        reason: "test revision",
        geometrySchemaVersion: GEOMETRY_SCHEMA_VERSION,
        buildPayload: (planId, revisionId) => ({
          schemaVersion: GEOMETRY_SCHEMA_VERSION,
          planId,
          revisionId,
          coordinateConventions: {
            units: "meters",
            plan: "x-z-projection",
            winding: "ccw",
            angles: "radians"
          },
          rooms: [
            {
              id: roomId,
              name: "Kitchen",
              sourceRoomId: roomId,
              boundary: [
                { x: 0, y: 0 },
                { x: 3, y: 0 },
                { x: 3, y: 3 },
                { x: 0, y: 3 }
              ],
              areaM2: 9,
              confidence: "high"
            }
          ],
          walls: [
            {
              id: wallId,
              sourceId: null,
              roomId,
              start: { x: 0, y: 0 },
              end: { x: 3, y: 0 },
              thicknessM: 0.12,
              heightM: 2.44,
              source: "roomplan",
              confidence: "high"
            }
          ],
          openings: [
            {
              id: "0198aaaa-0000-7000-8000-000000000003",
              sourceId: null,
              type: "window",
              wallId,
              offsetAlongWallM: 1.5,
              widthM: 0.9144,
              heightM: 1.2,
              sillHeightM: 0.9,
              roomIds: [roomId],
              confidence: "high",
              verification: "unverified"
            }
          ],
          validationFindings: []
        })
      })
    );

    const windows = await ctx.app.inject({
      method: "GET",
      url: `/v1/plans/${plan.id}/schedules/windows`,
      headers: asUser("frank", orgId)
    });
    expect(windows.statusCode).toBe(200);
    const body = windows.json();
    expect(body.displayUnits).toBe("imperial");
    expect(body.disclaimer).toMatch(/preliminary estimates/);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].key).toBe("W01");
    expect(body.data[0].rooms).toEqual(["Kitchen"]);
    expect(body.data[0].widthDisplay).toBe("3'-0\"");
    expect(body.data[0].verification).toBe("unverified");

    const doors = await ctx.app.inject({
      method: "GET",
      url: `/v1/plans/${plan.id}/schedules/doors`,
      headers: asUser("frank", orgId)
    });
    expect(doors.json().data).toHaveLength(0);

    const openings = await ctx.app.inject({
      method: "GET",
      url: `/v1/plans/${plan.id}/openings`,
      headers: asUser("frank", orgId)
    });
    expect(openings.json().data).toHaveLength(1);
    expect(uuidSchema.safeParse(openings.json().revisionId).success).toBe(true);
  });
});

describe("resumable chunked uploads", () => {
  it("resumes an interrupted multi-part upload and assembles the bundle", async () => {
    const orgId = await createOrg("judy", "Judy Field Services");
    const { propertyId, floorId } = await createPropertyAndFloor("judy", orgId);
    const sessionRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/scan-sessions",
      headers: { ...asUser("judy", orgId), "idempotency-key": "judy-1" },
      payload: { propertyId, floorId, requestedOutputs: ["normalized_json"] }
    });
    const sessionId = sessionRes.json().id;

    const { manifest, zip } = buildFixtureBundle(sessionId);
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const partSize = Math.ceil(zip.byteLength / 3);
    const parts = [
      zip.slice(0, partSize),
      zip.slice(partSize, 2 * partSize),
      zip.slice(2 * partSize)
    ];

    const uploadRes = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads`,
      headers: asUser("judy", orgId),
      payload: {
        captureId: manifest.captureId,
        byteSize: zip.byteLength,
        contentType: "application/zip",
        partCount: 3
      }
    });
    expect(uploadRes.statusCode).toBe(201);
    const upload = uploadRes.json();
    expect(upload.partCount).toBe(3);
    expect(upload.partUploadUrls).toHaveLength(3);
    expect(upload.uploadUrl).toBeNull();
    const uploadId = upload.uploadId;

    const putPart = (n: number, data: Uint8Array) =>
      ctx.app.inject({
        method: "PUT",
        url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}/parts/${n}`,
        headers: { ...asUser("judy", orgId), "content-type": "application/octet-stream" },
        payload: Buffer.from(data)
      });

    // Upload only the middle part, then "lose connectivity".
    expect((await putPart(2, parts[1]!)).statusCode).toBe(204);

    // Resume: server reports exactly which parts are missing.
    const statusRes = await ctx.app.inject({
      method: "GET",
      url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}`,
      headers: asUser("judy", orgId)
    });
    expect(statusRes.json().receivedParts).toEqual([2]);
    expect(statusRes.json().missingParts).toEqual([1, 3]);

    // Premature completion is refused with the missing parts listed.
    const early = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}/complete`,
      headers: asUser("judy", orgId),
      payload: { sha256, byteSize: zip.byteLength }
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().missingParts).toEqual([1, 3]);

    // Resume the remaining parts; re-uploading part 2 is idempotent.
    expect((await putPart(1, parts[0]!)).statusCode).toBe(204);
    expect((await putPart(2, parts[1]!)).statusCode).toBe(204);
    expect((await putPart(3, parts[2]!)).statusCode).toBe(204);

    // Out-of-range part numbers are rejected.
    expect((await putPart(4, parts[0]!)).statusCode).toBe(400);

    const complete = await ctx.app.inject({
      method: "POST",
      url: `/v1/scan-sessions/${sessionId}/uploads/${uploadId}/complete`,
      headers: asUser("judy", orgId),
      payload: { sha256, byteSize: zip.byteLength }
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe("uploaded");
  });
});

describe("media pipeline", () => {
  it("uploads, validates, strips JPEG EXIF, links to an opening, and serves downloads", async () => {
    const orgId = await createOrg("kira", "Kira Media Co");
    const { propertyId, floorId } = await createPropertyAndFloor("kira", orgId);

    // A plan revision with one relational opening to link photos to.
    const session = await createScanSession(ctx.pool, orgId, {
      propertyId,
      floorId,
      requestedOutputs: ["normalized_json"],
      externalReferences: []
    });
    const openingId = "0198bbbb-0000-7000-8000-000000000001";
    await withTransaction(ctx.pool, async (tx) => {
      const { revision } = await createPlanWithInitialRevision(tx, orgId, {
        floorId,
        scanSessionId: session.id,
        reason: "media test revision",
        geometrySchemaVersion: GEOMETRY_SCHEMA_VERSION,
        buildPayload: (planId, revisionId) => ({
          schemaVersion: GEOMETRY_SCHEMA_VERSION,
          planId,
          revisionId,
          coordinateConventions: {
            units: "meters",
            plan: "x-z-projection",
            winding: "ccw",
            angles: "radians"
          },
          rooms: [],
          walls: [],
          openings: [],
          validationFindings: []
        })
      });
      await tx.query(
        `insert into openings (id, organization_id, plan_revision_id, opening_type, room_ids)
         values ($1, $2, $3, 'window', '[]'::jsonb)`,
        [openingId, orgId, revision.id]
      );
    });

    const jpegWithExif = Buffer.from(buildJpeg({ withExif: true, withXmp: true }));
    const uploadedSha = createHash("sha256").update(jpegWithExif).digest("hex");

    // Register + upload bytes.
    const reg = await ctx.app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: asUser("kira", orgId),
      payload: { byteSize: jpegWithExif.byteLength, contentType: "image/jpeg" }
    });
    expect(reg.statusCode).toBe(201);
    const { mediaId } = reg.json();
    const put = await ctx.app.inject({
      method: "PUT",
      url: `/v1/media/uploads/${mediaId}/content`,
      headers: { ...asUser("kira", orgId), "content-type": "image/jpeg" },
      payload: jpegWithExif
    });
    expect(put.statusCode).toBe(204);

    // Complete: EXIF gets stripped, dimensions recorded.
    const complete = await ctx.app.inject({
      method: "POST",
      url: `/v1/media/uploads/${mediaId}/complete`,
      headers: asUser("kira", orgId),
      payload: { sha256: uploadedSha, byteSize: jpegWithExif.byteLength }
    });
    expect(complete.statusCode).toBe(200);
    const media = complete.json();
    expect(media.status).toBe("ready");
    expect(media.exifPolicy).toBe("exif_app1_stripped");
    expect(media.widthPx).toBe(2);
    expect(media.heightPx).toBe(3);
    // Stored sha differs from uploaded sha because EXIF was removed.
    expect(media.sha256).not.toBe(uploadedSha);

    // Download serves the stripped bytes (no EXIF payload marker).
    const download = await ctx.app.inject({
      method: "GET",
      url: `/v1/media/${mediaId}/content`,
      headers: asUser("kira", orgId)
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("image/jpeg");
    expect(download.rawPayload.toString("hex")).not.toContain("deadbeef");

    // Content-type spoofing is rejected: declared PNG, actual JPEG bytes.
    const spoofReg = await ctx.app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: asUser("kira", orgId),
      payload: { byteSize: jpegWithExif.byteLength, contentType: "image/png" }
    });
    const spoofId = spoofReg.json().mediaId;
    await ctx.app.inject({
      method: "PUT",
      url: `/v1/media/uploads/${spoofId}/content`,
      headers: { ...asUser("kira", orgId), "content-type": "image/png" },
      payload: jpegWithExif
    });
    const spoofComplete = await ctx.app.inject({
      method: "POST",
      url: `/v1/media/uploads/${spoofId}/complete`,
      headers: asUser("kira", orgId),
      payload: { sha256: uploadedSha, byteSize: jpegWithExif.byteLength }
    });
    expect(spoofComplete.statusCode).toBe(422);

    // Link to the opening and list with a download URL.
    const link = await ctx.app.inject({
      method: "POST",
      url: `/v1/openings/${openingId}/media-links`,
      headers: asUser("kira", orgId),
      payload: { mediaId, position: 0 }
    });
    expect(link.statusCode).toBe(201);

    const list = await ctx.app.inject({
      method: "GET",
      url: `/v1/openings/${openingId}/media-links`,
      headers: asUser("kira", orgId)
    });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].downloadUrl).toContain(`/v1/media/${mediaId}/content`);

    // Cross-tenant media access is denied.
    const otherOrg = await createOrg("liam", "Liam Co");
    const cross = await ctx.app.inject({
      method: "GET",
      url: `/v1/media/${mediaId}/content`,
      headers: asUser("liam", otherOrg)
    });
    expect(cross.statusCode).toBe(404);
  });
});

describe("plan corrections and acceptance", () => {
  async function seedPlan(userId: string, orgId: string, floorId: string, sessionId: string) {
    const roomId = "0198cccc-0000-7000-8000-000000000001";
    const wallId = "0198cccc-0000-7000-8000-000000000002";
    const openingId = "0198cccc-0000-7000-8000-000000000003";
    const { plan, revision } = await withTransaction(ctx.pool, (tx) =>
      createPlanWithInitialRevision(tx, orgId, {
        floorId,
        scanSessionId: sessionId,
        reason: "import",
        geometrySchemaVersion: GEOMETRY_SCHEMA_VERSION,
        buildPayload: (planId, revisionId) => ({
          schemaVersion: GEOMETRY_SCHEMA_VERSION,
          planId,
          revisionId,
          coordinateConventions: {
            units: "meters",
            plan: "x-z-projection",
            winding: "ccw",
            angles: "radians"
          },
          rooms: [
            {
              id: roomId,
              name: "Kitchen",
              sourceRoomId: roomId,
              boundary: [
                { x: 0, y: 0 },
                { x: 3, y: 0 },
                { x: 3, y: 3 },
                { x: 0, y: 3 }
              ],
              areaM2: 9,
              confidence: "high"
            }
          ],
          walls: [
            {
              id: wallId,
              sourceId: null,
              roomId,
              start: { x: 0, y: 0 },
              end: { x: 3, y: 0 },
              thicknessM: 0.12,
              heightM: 2.44,
              source: "roomplan",
              confidence: "high"
            }
          ],
          openings: [
            {
              id: openingId,
              sourceId: null,
              type: "window",
              wallId,
              offsetAlongWallM: 1.5,
              widthM: 0.9,
              heightM: 1.2,
              sillHeightM: 0.9,
              roomIds: [roomId],
              confidence: "medium",
              verification: "unverified"
            }
          ],
          validationFindings: []
        })
      })
    );
    return { plan, revision, roomId, wallId, openingId };
  }

  it("applies typed commands into a new immutable revision, verifies, and accepts", async () => {
    const orgId = await createOrg("mia", "Mia Corrections Co");
    const { propertyId, floorId } = await createPropertyAndFloor("mia", orgId);
    const session = await createScanSession(ctx.pool, orgId, {
      propertyId,
      floorId,
      requestedOutputs: ["normalized_json"],
      externalReferences: []
    });
    // Put the session into needs_review so acceptance can complete it.
    for (const [from, to] of [
      ["draft", "capturing"],
      ["capturing", "local_review"],
      ["local_review", "queued_upload"],
      ["queued_upload", "uploading"],
      ["uploading", "processing"],
      ["processing", "needs_review"]
    ]) {
      await ctx.pool.query("update scan_sessions set status = $1 where id = $2 and status = $3", [
        to,
        session.id,
        from
      ]);
    }
    const { plan, revision, roomId, wallId, openingId } = await seedPlan(
      "mia",
      orgId,
      floorId,
      session.id
    );

    const correction = await ctx.app.inject({
      method: "POST",
      url: `/v1/plans/${plan.id}/revisions`,
      headers: asUser("mia", orgId),
      payload: {
        parentRevisionId: revision.id,
        reason: "field corrections",
        commands: [
          { type: "renameRoom", roomId, name: "Kitchen (verified)" },
          { type: "verifyOpening", openingId, source: "laser", widthM: 0.914, heightM: 1.219 },
          {
            type: "addOpening",
            opening: {
              openingType: "door",
              wallId,
              roomIds: [roomId],
              widthM: 0.91,
              heightM: 2.03,
              sillHeightM: null
            }
          }
        ]
      }
    });
    expect(correction.statusCode).toBe(201);
    const v2 = correction.json();
    expect(v2.version).toBe(2);
    expect(v2.parentRevisionId).toBe(revision.id);
    expect(v2.payload.rooms[0].name).toBe("Kitchen (verified)");
    const verified = v2.payload.openings.find((o: { id: string }) => o.id === openingId);
    expect(verified.verification).toBe("field_verified");
    expect(verified.widthM).toBeCloseTo(0.914);
    expect(v2.payload.openings).toHaveLength(2);

    // Parent revision is untouched (immutable).
    const parentRes = await ctx.app.inject({
      method: "GET",
      url: `/v1/plans/${plan.id}/revisions/${revision.id}`,
      headers: asUser("mia", orgId)
    });
    expect(parentRes.json().payload.rooms[0].name).toBe("Kitchen");
    expect(parentRes.json().payload.openings).toHaveLength(1);

    // Measurement provenance recorded for the laser verification.
    const measurements = await ctx.pool.query(
      "select * from measurements where subject_id = $1 order by semantic_type",
      [openingId]
    );
    expect(measurements.rows.map((m) => m.semantic_type)).toEqual(["height", "width"]);
    expect(measurements.rows.every((m) => m.source === "laser")).toBe(true);
    expect(measurements.rows.every((m) => m.verification === "field_verified")).toBe(true);

    // Stale save (old parent) is refused with the current revision id.
    const stale = await ctx.app.inject({
      method: "POST",
      url: `/v1/plans/${plan.id}/revisions`,
      headers: asUser("mia", orgId),
      payload: {
        parentRevisionId: revision.id,
        reason: "stale",
        commands: [{ type: "renameRoom", roomId, name: "X" }]
      }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().currentRevisionId).toBe(v2.id);

    // Unknown reference is a command error, not a corrupt revision.
    const badRef = await ctx.app.inject({
      method: "POST",
      url: `/v1/plans/${plan.id}/revisions`,
      headers: asUser("mia", orgId),
      payload: {
        parentRevisionId: v2.id,
        reason: "bad",
        commands: [{ type: "removeOpening", openingId: "0198cccc-9999-7000-8000-000000000009" }]
      }
    });
    expect(badRef.statusCode).toBe(422);

    // Accepting an old revision is refused; accepting the current succeeds.
    const acceptOld = await ctx.app.inject({
      method: "POST",
      url: `/v1/plans/${plan.id}/revisions/${revision.id}/accept`,
      headers: asUser("mia", orgId)
    });
    expect(acceptOld.statusCode).toBe(409);

    const accept = await ctx.app.inject({
      method: "POST",
      url: `/v1/plans/${plan.id}/revisions/${v2.id}/accept`,
      headers: asUser("mia", orgId)
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().status).toBe("accepted");

    const superseded = await ctx.pool.query("select status from plan_revisions where id = $1", [
      revision.id
    ]);
    expect(superseded.rows[0].status).toBe("superseded");

    const sessionAfter = await ctx.pool.query("select status from scan_sessions where id = $1", [
      session.id
    ]);
    expect(sessionAfter.rows[0].status).toBe("completed");

    const outbox = await ctx.pool.query(
      "select event_type from outbox_events where organization_id = $1 and event_type = 'plan.accepted'",
      [orgId]
    );
    expect(outbox.rows).toHaveLength(1);
  });
});
