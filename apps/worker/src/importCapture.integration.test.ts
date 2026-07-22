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
import {
  buildFixtureBundle,
  TWO_ROOM_FIXTURE,
  type FixtureOptions
} from "@propertyscan/roomplan-fixtures";
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

async function prepareSession(options?: FixtureOptions): Promise<SessionFixture> {
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

  const { zip } = buildFixtureBundle(session.id, options ?? {});
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

    // Normalized geometry: closed boundaries with real areas (3.6×3.0, 4.8×4.2).
    const kitchen = payload.rooms.find((r) => r.name === "Kitchen")!;
    const living = payload.rooms.find((r) => r.name === "Living Room")!;
    expect(Array.isArray(kitchen.boundary)).toBe(true);
    expect(kitchen.boundary).toHaveLength(4);
    expect(kitchen.areaM2 as number).toBeCloseTo(10.8, 1);
    expect(living.areaM2 as number).toBeCloseTo(20.16, 1);
    expect(payload.rooms.every((r) => r.boundary !== NOT_PROCESSED)).toBe(true);

    // 4 walls per room; every wall carries endpoints and provenance.
    expect(payload.walls).toHaveLength(8);
    for (const wall of payload.walls) {
      expect(typeof wall.start).toBe("object");
      expect(wall.source).toBe("roomplan");
      expect(wall.sourceId).toBeTruthy();
    }

    // Openings: 3 windows, 2 doors, 1 open passage — all attached to host walls.
    const byType = (t: string) => payload.openings.filter((o) => o.type === t);
    expect(byType("window")).toHaveLength(3);
    expect(byType("door")).toHaveLength(2);
    expect(byType("open_passage")).toHaveLength(1);
    const wallIds = new Set(payload.walls.map((w) => w.id));
    for (const opening of payload.openings) {
      expect(opening.wallId && wallIds.has(opening.wallId)).toBe(true);
      expect(typeof opening.offsetAlongWallM).toBe("number");
      expect(opening.verification).toBe("unverified");
    }
    // Kitchen window: center 1.5 m, height 1.1 m → sill 0.95 m.
    const kitchenWindow = payload.openings.find(
      (o) => o.sourceId === "5f3a1b2c-2001-4a00-9000-00000000c001"
    )!;
    expect(kitchenWindow.sillHeightM as number).toBeCloseTo(0.95, 2);

    // The living room is placed by the structure transform (180° about Y,
    // translated), so its boundary must not overlap the kitchen's origin box.
    const livingXs = (living.boundary as Array<{ x: number }>).map((p) => p.x);
    expect(Math.min(...livingXs)).toBeLessThan(0);

    expect(payload.validationFindings.map((f) => f.code)).not.toContain("room_not_closed");

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

    // Rooms, walls, and openings materialized relationally too.
    const rooms = await pool.query("select * from rooms where plan_revision_id = $1", [
      revision!.id
    ]);
    expect(rooms.rows).toHaveLength(2);
    expect(rooms.rows.every((r) => r.area_m2 > 0 && Array.isArray(r.boundary))).toBe(true);
    const wallRows = await pool.query(
      "select count(*)::int as n from walls where plan_revision_id = $1",
      [revision!.id]
    );
    expect(wallRows.rows[0].n).toBe(8);
    const openingRows = await pool.query(
      "select count(*)::int as n from openings where plan_revision_id = $1",
      [revision!.id]
    );
    expect(openingRows.rows[0].n).toBe(6);
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

describe("import fixture matrix (spec §15.1)", () => {
  it("imports a single room without a structure result", async () => {
    const fixture = await prepareSession({ variant: "single-room" });
    expect(await tick(deps)).toBe(true);

    const session = await findScanSessionById(pool, fixture.organizationId, fixture.scanSessionId);
    expect(session?.status).toBe("needs_review");

    const planRows = await pool.query("select * from plans where id = $1", [session!.plan_id]);
    const revision = await findPlanRevision(
      pool,
      fixture.organizationId,
      planRows.rows[0].id,
      planRows.rows[0].current_revision_id
    );
    const payload = revision!.payload;
    expect(payload.rooms).toHaveLength(1);
    expect(Array.isArray(payload.rooms[0]!.boundary)).toBe(true);
    expect(payload.validationFindings.map((f) => f.code)).toContain("structure_missing");
  });

  it("keeps an unclosable room explicitly not_processed with a finding", async () => {
    const fixture = await prepareSession({ variant: "missing-wall" });
    expect(await tick(deps)).toBe(true);

    const session = await findScanSessionById(pool, fixture.organizationId, fixture.scanSessionId);
    expect(session?.status).toBe("needs_review");

    const planRows = await pool.query("select * from plans where id = $1", [session!.plan_id]);
    const revision = await findPlanRevision(
      pool,
      fixture.organizationId,
      planRows.rows[0].id,
      planRows.rows[0].current_revision_id
    );
    const payload = revision!.payload;
    expect(payload.rooms[0]!.boundary).toBe(NOT_PROCESSED);
    expect(payload.rooms[0]!.areaM2).toBe(NOT_PROCESSED);
    expect(payload.walls).toHaveLength(3);
    expect(payload.validationFindings.map((f) => f.code)).toContain("room_not_closed");
  });

  it("rejects an unsupported manifest schema version with a visible failure", async () => {
    const fixture = await prepareSession({ variant: "unsupported-schema" });
    expect(await tick(deps)).toBe(true);

    const session = await findScanSessionById(pool, fixture.organizationId, fixture.scanSessionId);
    expect(session?.status).toBe("failed");
    expect(session?.failure_reason).toMatch(/manifest failed schema validation/);

    const run = await pool.query("select * from import_runs where id = $1", [fixture.importRunId]);
    expect(run.rows[0].status).toBe("failed");
  });
});

describe("duplicate opening detection", () => {
  it("flags coincident same-type openings for review without auto-merging", async () => {
    const fixture = await prepareSession({ variant: "duplicate-opening" });
    expect(await tick(deps)).toBe(true);

    const session = await findScanSessionById(pool, fixture.organizationId, fixture.scanSessionId);
    expect(session?.status).toBe("needs_review");

    const planRows = await pool.query("select * from plans where id = $1", [session!.plan_id]);
    const revision = await findPlanRevision(
      pool,
      fixture.organizationId,
      planRows.rows[0].id,
      planRows.rows[0].current_revision_id
    );
    const payload = revision!.payload;

    // Both observations are preserved — resolution belongs to human review.
    const doors = payload.openings.filter((o) => o.type === "door");
    expect(doors).toHaveLength(2);

    const duplicateFindings = payload.validationFindings.filter(
      (f) => f.code === "duplicate_opening_candidate"
    );
    expect(duplicateFindings).toHaveLength(1);
    expect(duplicateFindings[0]!.message).toContain("5f3a1b2c-3001");
    expect(duplicateFindings[0]!.message).toContain("5f3a1b2c-3002");
  });
});

describe("outbox webhook dispatch", () => {
  it("delivers signed events to registered endpoints, retries failures, deduplicates", async () => {
    const { createServer } = await import("node:http");
    const { createOrganizationWithOwner: mkOrg } = await import("@propertyscan/database");
    const { createWebhookEndpoint, appendOutboxEvent } = await import("@propertyscan/database");
    const { verifyWebhookSignature, SIGNATURE_HEADER } =
      await import("@propertyscan/integration-studiokl");
    const { dispatchOutbox } = await import("./dispatchOutbox.js");

    const masterKey = "dev-only-not-a-real-key-0000000000000000";
    const secret = "webhook-test-secret-0001";
    const org = await mkOrg(pool, { name: "Webhook Org", ownerUserId: "user_webhook" });

    const received: Array<{ body: string; signature: string }> = [];
    let failNext = true;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (failNext) {
          failNext = false;
          res.writeHead(500).end();
          return;
        }
        received.push({ body, signature: String(req.headers[SIGNATURE_HEADER] ?? "") });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    await createWebhookEndpoint(pool, org.id, {
      url: `http://127.0.0.1:${port}/hooks`,
      secret,
      masterKey
    });
    const eventId = await appendOutboxEvent(pool, {
      organizationId: org.id,
      eventType: "plan.accepted",
      resourceType: "plan",
      resourceId: "0198dddd-0000-7000-8000-000000000001",
      payload: { planId: "0198dddd-0000-7000-8000-000000000001" }
    });

    const dispatchDeps = {
      pool,
      log: deps.log,
      masterKey,
      externalWebhooksDisabled: true // localhost is still permitted
    };

    // First pass: endpoint fails -> delivery marked failed with backoff.
    await dispatchOutbox(dispatchDeps);
    let delivery = await pool.query("select * from webhook_deliveries where outbox_event_id = $1", [
      eventId
    ]);
    expect(delivery.rows[0].status).toBe("failed");
    expect(delivery.rows[0].attempts).toBe(1);

    // Force the retry window open and dispatch again: delivered + verifiable.
    await pool.query(
      "update webhook_deliveries set next_attempt_at = now() where outbox_event_id = $1",
      [eventId]
    );
    await dispatchOutbox(dispatchDeps);
    delivery = await pool.query("select * from webhook_deliveries where outbox_event_id = $1", [
      eventId
    ]);
    expect(delivery.rows[0].status).toBe("succeeded");
    expect(received).toHaveLength(1);

    const verdict = verifyWebhookSignature(received[0]!.body, received[0]!.signature, {
      secretsByKeyId: { k1: secret }
    });
    expect(verdict).toMatchObject({ ok: true, keyId: "k1" });
    const envelope = JSON.parse(received[0]!.body);
    expect(envelope.eventId).toBe(eventId);
    expect(envelope.eventType).toBe("plan.accepted");

    // Re-running the dispatcher does not deliver the same event twice.
    await dispatchOutbox(dispatchDeps);
    expect(received).toHaveLength(1);

    server.close();
  });
});
