import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDatabase } from "@propertyscan/database/dist/testing.js";
import {
  createFloor,
  createOrGetCaptureArtifact,
  createImportRun,
  createOrganizationWithOwner,
  createProperty,
  createScanSession,
  enqueueJob,
  findPlanRevision,
  findScanSessionById,
  markCaptureArtifactUploaded,
  transitionScanSession
} from "@propertyscan/database";
import { createFsStorage, type ObjectStorage } from "@propertyscan/storage";
import { buildFixtureBundle, TWO_ROOM_FIXTURE } from "@propertyscan/roomplan-fixtures";
import { NOT_PROCESSED } from "@propertyscan/contracts";
import { createLogger } from "@propertyscan/observability";

import { tick, type WorkerDeps } from "./worker.js";

let pool: pg.Pool;
let teardownDb: () => Promise<void>;
let storage: ObjectStorage;
let storageRoot: string;
let deps: WorkerDeps;

beforeAll(async () => {
  ({ pool, teardown: teardownDb } = await createTestDatabase());
  storageRoot = await mkdtemp(join(tmpdir(), "ps-worker-test-"));
  storage = createFsStorage(storageRoot);
  deps = { pool, storage, log: createLogger("worker-test", "silent"), workerId: "worker-test" };
});

afterAll(async () => {
  await teardownDb();
  await rm(storageRoot, { recursive: true, force: true });
});

interface SessionFixture {
  organizationId: string;
  scanSessionId: string;
  artifactId: string;
  importRunId: string;
  jobKey: string;
}

async function prepareSession(options?: { corruptChecksums?: boolean }): Promise<SessionFixture> {
  const org = await createOrganizationWithOwner(pool, {
    name: `Worker Org ${Math.random().toString(36).slice(2, 8)}`,
    ownerUserId: "user_worker_test"
  });
  const property = await createProperty(pool, org.id, { name: "Worker House" });
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

  const { zip } = buildFixtureBundle(session.id, {
    ...(options?.corruptChecksums ? { corruptChecksums: true } : {})
  });
  const sha256 = createHash("sha256").update(zip).digest("hex");
  const objectKey = `orgs/${org.id}/scans/${session.id}/captures/${TWO_ROOM_FIXTURE.captureId}/bundle.zip`;
  await storage.put(objectKey, zip, "application/zip");

  const artifact = await createOrGetCaptureArtifact(pool, org.id, {
    scanSessionId: session.id,
    captureId: TWO_ROOM_FIXTURE.captureId,
    objectKey,
    contentType: "application/zip"
  });
  await markCaptureArtifactUploaded(pool, org.id, artifact.id, {
    sha256,
    byteSize: zip.byteLength
  });

  for (const [from, to] of [
    ["draft", "capturing"],
    ["capturing", "local_review"],
    ["local_review", "queued_upload"],
    ["queued_upload", "uploading"],
    ["uploading", "processing"]
  ] as const) {
    await transitionScanSession(pool, org.id, session.id, from, to);
  }

  const importRun = await createImportRun(pool, org.id, {
    scanSessionId: session.id,
    captureArtifactId: artifact.id
  });
  const jobKey = `import:${session.id}:${sha256}`;
  await enqueueJob(pool, {
    jobKey,
    jobType: "import_capture",
    payload: {
      importRunId: importRun.id,
      organizationId: org.id,
      scanSessionId: session.id,
      captureArtifactId: artifact.id
    }
  });
  return {
    organizationId: org.id,
    scanSessionId: session.id,
    artifactId: artifact.id,
    importRunId: importRun.id,
    jobKey
  };
}

describe("import_capture job", () => {
  it("imports the fixture bundle into a plan revision with explicit not_processed geometry", async () => {
    const fixture = await prepareSession();
    expect(await tick(deps)).toBe(true);

    const session = await findScanSessionById(pool, fixture.organizationId, fixture.scanSessionId);
    expect(session?.status).toBe("needs_review");
    expect(session?.plan_id).toBeTruthy();

    const planRows = await pool.query("select * from plans where id = $1", [session!.plan_id]);
    const plan = planRows.rows[0];
    const revision = await findPlanRevision(
      pool,
      fixture.organizationId,
      plan.id,
      plan.current_revision_id
    );
    expect(revision).not.toBeNull();
    expect(revision!.status).toBe("draft");
    expect(revision!.version).toBe(1);
    expect(revision!.author_type).toBe("import");

    const payload = revision!.payload;
    expect(payload.rooms).toHaveLength(2);
    const names = payload.rooms.map((r) => r.name).sort();
    expect(names).toEqual(["Kitchen", "Living Room"]);
    for (const room of payload.rooms) {
      expect(room.boundary).toBe(NOT_PROCESSED);
      expect(room.areaM2).toBe(NOT_PROCESSED);
      expect(["high", "medium", "low", "unknown"]).toContain(room.confidence);
    }
    expect(payload.validationFindings.map((f) => f.code)).toContain("geometry_not_normalized");

    // Raw artifacts preserved immutably.
    const rawKey = `orgs/${fixture.organizationId}/scans/${fixture.scanSessionId}/captures/${TWO_ROOM_FIXTURE.captureId}/raw/roomplan/structure.json`;
    expect(await storage.exists(rawKey)).toBe(true);

    // Import run recorded as succeeded with findings.
    const run = await pool.query("select * from import_runs where id = $1", [fixture.importRunId]);
    expect(run.rows[0].status).toBe("succeeded");

    // Outbox event only after durable commit.
    const outbox = await pool.query(
      "select event_type from outbox_events where organization_id = $1 order by created_at",
      [fixture.organizationId]
    );
    expect(outbox.rows.map((r) => r.event_type)).toContain("scan.needs_review");

    // Room stubs materialized relationally too.
    const rooms = await pool.query("select * from rooms where plan_revision_id = $1", [
      revision!.id
    ]);
    expect(rooms.rows).toHaveLength(2);
  });

  it("re-running the same job key does not duplicate plans", async () => {
    const fixture = await prepareSession();
    expect(await tick(deps)).toBe(true);

    // Re-enqueue with same key: enqueueJob returns existing succeeded job; force re-queue to
    // simulate an at-least-once redelivery.
    await pool.query("update jobs set status = 'queued', run_at = now() where job_key = $1", [
      fixture.jobKey
    ]);
    expect(await tick(deps)).toBe(true);

    // The redelivered job fails terminally (session no longer 'processing') and
    // must not create a second plan; the session keeps its needs_review state.
    const plans = await pool.query(
      "select count(*)::int as n from plans where scan_session_id = $1",
      [fixture.scanSessionId]
    );
    expect(plans.rows[0].n).toBe(1);
  });

  it("fails visibly on checksum mismatch", async () => {
    const fixture = await prepareSession({ corruptChecksums: true });
    expect(await tick(deps)).toBe(true);

    const session = await findScanSessionById(pool, fixture.organizationId, fixture.scanSessionId);
    expect(session?.status).toBe("failed");
    expect(session?.failure_reason).toMatch(/checksum mismatch/);

    const run = await pool.query("select * from import_runs where id = $1", [fixture.importRunId]);
    expect(run.rows[0].status).toBe("failed");

    const outbox = await pool.query(
      "select event_type from outbox_events where organization_id = $1",
      [fixture.organizationId]
    );
    expect(outbox.rows.map((r) => r.event_type)).toContain("scan.failed");
  });
});
