import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import { createTestDatabase } from "./testing.js";
import { createOrganizationWithOwner, findMembership } from "./repositories/organizations.js";
import { createProperty, findPropertyById, listProperties } from "./repositories/properties.js";
import { createFloor, findFloorById } from "./repositories/floors.js";
import {
  createScanSession,
  findScanSessionById,
  transitionScanSession
} from "./repositories/scanSessions.js";
import { issueHandoffToken, redeemHandoffToken } from "./repositories/handoffTokens.js";
import { claimNextJob, completeJob, enqueueJob, failJob } from "./repositories/jobs.js";

let pool: pg.Pool;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ pool, teardown } = await createTestDatabase());
});

afterAll(async () => {
  await teardown();
});

describe("tenant isolation", () => {
  it("scopes properties, floors, and scan sessions to their organization", async () => {
    const orgA = await createOrganizationWithOwner(pool, { name: "Org A", ownerUserId: "user_a" });
    const orgB = await createOrganizationWithOwner(pool, { name: "Org B", ownerUserId: "user_b" });

    const property = await createProperty(pool, orgA.id, { name: "A House" });
    const floor = await createFloor(pool, orgA.id, {
      propertyId: property.id,
      name: "Ground",
      ordinal: 0,
      displayUnits: "imperial"
    });
    const session = await createScanSession(pool, orgA.id, {
      propertyId: property.id,
      floorId: floor.id,
      requestedOutputs: ["normalized_json"],
      externalReferences: []
    });

    // Org B must not see any of Org A's records even with valid IDs.
    expect(await findPropertyById(pool, orgB.id, property.id)).toBeNull();
    expect(await findFloorById(pool, orgB.id, floor.id)).toBeNull();
    expect(await findScanSessionById(pool, orgB.id, session.id)).toBeNull();
    expect(await listProperties(pool, orgB.id, { limit: 100 })).toHaveLength(0);

    expect(await findPropertyById(pool, orgA.id, property.id)).not.toBeNull();
    expect(await findMembership(pool, { userId: "user_a", organizationId: orgB.id })).toBeNull();
  });

  it("enforces guarded scan-session transitions", async () => {
    const org = await createOrganizationWithOwner(pool, { name: "Org C", ownerUserId: "user_c" });
    const property = await createProperty(pool, org.id, { name: "C House" });
    const floor = await createFloor(pool, org.id, {
      propertyId: property.id,
      name: "Ground",
      ordinal: 0,
      displayUnits: "metric"
    });
    const session = await createScanSession(pool, org.id, {
      propertyId: property.id,
      floorId: floor.id,
      requestedOutputs: ["normalized_json"],
      externalReferences: []
    });

    const captured = await transitionScanSession(pool, org.id, session.id, "draft", "capturing");
    expect(captured?.status).toBe("capturing");

    // Stale transition (draft no longer current) must not apply.
    expect(await transitionScanSession(pool, org.id, session.id, "draft", "capturing")).toBeNull();

    // Illegal transition throws before touching the database.
    await expect(
      transitionScanSession(pool, org.id, session.id, "capturing", "completed")
    ).rejects.toThrow(/Illegal/);
  });
});

describe("handoff tokens", () => {
  it("issues single-use expiring tokens storing only the hash", async () => {
    const org = await createOrganizationWithOwner(pool, { name: "Org D", ownerUserId: "user_d" });
    const property = await createProperty(pool, org.id, { name: "D House" });
    const floor = await createFloor(pool, org.id, {
      propertyId: property.id,
      name: "Ground",
      ordinal: 0,
      displayUnits: "imperial"
    });
    const session = await createScanSession(pool, org.id, {
      propertyId: property.id,
      floorId: floor.id,
      requestedOutputs: ["normalized_json"],
      externalReferences: []
    });

    const { token, row } = await issueHandoffToken(pool, org.id, session.id, 900);
    expect(row.token_hash).not.toContain(token);

    const redeemed = await redeemHandoffToken(pool, token);
    expect(redeemed?.scan_session_id).toBe(session.id);

    // Single use: second redemption fails.
    expect(await redeemHandoffToken(pool, token)).toBeNull();

    // Expired tokens never redeem.
    const { token: expired } = await issueHandoffToken(pool, org.id, session.id, -1);
    expect(await redeemHandoffToken(pool, expired)).toBeNull();
  });
});

describe("job queue", () => {
  it("is idempotent on job_key and retries with backoff to dead-letter", async () => {
    const first = await enqueueJob(pool, { jobKey: "import:abc", jobType: "import", payload: {} });
    const dup = await enqueueJob(pool, { jobKey: "import:abc", jobType: "import", payload: {} });
    expect(dup.id).toBe(first.id);

    const claimed = await claimNextJob(pool, "worker-test");
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe("running");

    // No second claim while running.
    expect(await claimNextJob(pool, "worker-test-2")).toBeNull();

    await completeJob(pool, first.id);
    const { rows } = await pool.query("select status from jobs where id = $1", [first.id]);
    expect(rows[0].status).toBe("succeeded");

    // Failure path: exhaust attempts -> dead.
    const failing = await enqueueJob(pool, {
      jobKey: "import:fail",
      jobType: "import",
      payload: {}
    });
    await pool.query("update jobs set max_attempts = 1 where id = $1", [failing.id]);
    const claimedFailing = await claimNextJob(pool, "worker-test");
    expect(claimedFailing?.id).toBe(failing.id);
    await failJob(pool, claimedFailing!, "boom");
    const dead = await pool.query("select status, last_error from jobs where id = $1", [
      failing.id
    ]);
    expect(dead.rows[0].status).toBe("dead");
    expect(dead.rows[0].last_error).toBe("boom");
  });
});
