import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureBundle } from "@propertyscan/roomplan-fixtures";

import { asUser, createTestApp, type TestApp } from "./testSupport.js";

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
