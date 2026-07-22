import type { PlanRevisionPayload } from "@propertyscan/contracts";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface PlanRow {
  id: string;
  organization_id: string;
  floor_id: string;
  scan_session_id: string | null;
  current_revision_id: string | null;
  created_at: Date;
}

export interface PlanRevisionRow {
  id: string;
  organization_id: string;
  plan_id: string;
  parent_revision_id: string | null;
  author_type: "import" | "user" | "system";
  reason: string;
  status: "draft" | "accepted" | "superseded";
  version: number;
  geometry_schema_version: string;
  payload: PlanRevisionPayload;
  created_at: Date;
}

/**
 * Create a plan and its immutable initial revision in one unit of work.
 * Call inside a transaction (withTransaction) so partially-created plans
 * never become visible.
 */
export async function createPlanWithInitialRevision(
  db: Queryable,
  organizationId: string,
  input: {
    floorId: string;
    scanSessionId: string;
    reason: string;
    geometrySchemaVersion: string;
    buildPayload: (planId: string, revisionId: string) => PlanRevisionPayload;
  }
): Promise<{ plan: PlanRow; revision: PlanRevisionRow }> {
  const planId = uuidv7();
  const revisionId = uuidv7();
  const payload = input.buildPayload(planId, revisionId);

  const planRes = await db.query(
    `insert into plans (id, organization_id, floor_id, scan_session_id)
     values ($1, $2, $3, $4) returning *`,
    [planId, organizationId, input.floorId, input.scanSessionId]
  );
  const revisionRes = await db.query(
    `insert into plan_revisions
       (id, organization_id, plan_id, parent_revision_id, author_type, reason, status, version, geometry_schema_version, payload)
     values ($1, $2, $3, null, 'import', $4, 'draft', 1, $5, $6) returning *`,
    [
      revisionId,
      organizationId,
      planId,
      input.reason,
      input.geometrySchemaVersion,
      JSON.stringify(payload)
    ]
  );
  await db.query("update plans set current_revision_id = $1 where id = $2", [revisionId, planId]);

  const plan = planRes.rows[0] as PlanRow;
  plan.current_revision_id = revisionId;
  return { plan, revision: revisionRes.rows[0] as PlanRevisionRow };
}

export async function findPlanById(
  db: Queryable,
  organizationId: string,
  planId: string
): Promise<PlanRow | null> {
  const { rows } = await db.query("select * from plans where id = $1 and organization_id = $2", [
    planId,
    organizationId
  ]);
  return (rows[0] as PlanRow | undefined) ?? null;
}

export async function findPlanRevision(
  db: Queryable,
  organizationId: string,
  planId: string,
  revisionId: string
): Promise<PlanRevisionRow | null> {
  const { rows } = await db.query(
    "select * from plan_revisions where id = $1 and plan_id = $2 and organization_id = $3",
    [revisionId, planId, organizationId]
  );
  return (rows[0] as PlanRevisionRow | undefined) ?? null;
}

export async function insertRoomRecord(
  db: Queryable,
  organizationId: string,
  input: {
    id: string;
    planRevisionId: string;
    sourceRoomId: string;
    name: string | null;
    confidence: "high" | "medium" | "low" | "unknown";
    boundary: Array<{ x: number; y: number }> | null;
    areaM2: number | null;
  }
): Promise<void> {
  await db.query(
    `insert into rooms (id, organization_id, plan_revision_id, source_room_id, name, confidence, boundary, area_m2)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      organizationId,
      input.planRevisionId,
      input.sourceRoomId,
      input.name,
      input.confidence,
      input.boundary ? JSON.stringify(input.boundary) : null,
      input.areaM2
    ]
  );
}

export async function insertWallRecord(
  db: Queryable,
  organizationId: string,
  input: { planRevisionId: string; wall: PlanRevisionPayload["walls"][number] }
): Promise<void> {
  const { wall } = input;
  const start = typeof wall.start === "string" ? null : wall.start;
  const end = typeof wall.end === "string" ? null : wall.end;
  await db.query(
    `insert into walls (id, organization_id, plan_revision_id, room_id, start_x, start_y, end_x, end_y,
                        thickness_m, height_m, source, confidence, source_metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      wall.id,
      organizationId,
      input.planRevisionId,
      wall.roomId,
      start?.x ?? null,
      start?.y ?? null,
      end?.x ?? null,
      end?.y ?? null,
      wall.thicknessM,
      wall.heightM,
      wall.source,
      wall.confidence,
      JSON.stringify({ sourceId: wall.sourceId })
    ]
  );
}

export async function insertOpeningRecord(
  db: Queryable,
  organizationId: string,
  input: { planRevisionId: string; opening: PlanRevisionPayload["openings"][number] }
): Promise<void> {
  const { opening } = input;
  const num = (v: number | string | null): number | null => (typeof v === "number" ? v : null);
  await db.query(
    `insert into openings (id, organization_id, plan_revision_id, wall_id, opening_type,
                           offset_along_wall_m, width_m, height_m, sill_height_m, room_ids,
                           confidence, verification, source_metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      opening.id,
      organizationId,
      input.planRevisionId,
      opening.wallId,
      opening.type,
      num(opening.offsetAlongWallM),
      num(opening.widthM),
      num(opening.heightM),
      num(opening.sillHeightM),
      JSON.stringify(opening.roomIds),
      opening.confidence,
      opening.verification,
      JSON.stringify({ sourceId: opening.sourceId })
    ]
  );
}

/**
 * Insert a child revision (user correction). Caller runs inside a transaction
 * and is responsible for having verified optimistic concurrency against the
 * plan's current revision. The parent revision is never mutated.
 */
export async function insertChildRevision(
  db: Queryable,
  organizationId: string,
  input: {
    planId: string;
    parentRevision: PlanRevisionRow;
    reason: string;
    authorType: "user" | "system";
    buildPayload: (revisionId: string) => PlanRevisionPayload;
  }
): Promise<PlanRevisionRow> {
  const revisionId = uuidv7();
  const payload = input.buildPayload(revisionId);
  const { rows } = await db.query(
    `insert into plan_revisions
       (id, organization_id, plan_id, parent_revision_id, author_type, reason, status, version, geometry_schema_version, payload)
     values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9) returning *`,
    [
      revisionId,
      organizationId,
      input.planId,
      input.parentRevision.id,
      input.authorType,
      input.reason,
      input.parentRevision.version + 1,
      input.parentRevision.geometry_schema_version,
      JSON.stringify(payload)
    ]
  );
  await db.query("update plans set current_revision_id = $1 where id = $2", [
    revisionId,
    input.planId
  ]);
  return rows[0] as PlanRevisionRow;
}

/**
 * Accept a revision: it becomes the plan's authoritative geometry; every other
 * revision of the plan is marked superseded (never deleted, never mutated in
 * content). Returns null when the revision is not the plan's current revision.
 */
export async function acceptRevision(
  db: Queryable,
  organizationId: string,
  planId: string,
  revisionId: string
): Promise<PlanRevisionRow | null> {
  const plan = await findPlanById(db, organizationId, planId);
  if (!plan || plan.current_revision_id !== revisionId) {
    return null;
  }
  await db.query(
    `update plan_revisions set status = 'superseded'
     where plan_id = $1 and organization_id = $2 and id <> $3 and status <> 'superseded'`,
    [planId, organizationId, revisionId]
  );
  const { rows } = await db.query(
    `update plan_revisions set status = 'accepted'
     where id = $1 and plan_id = $2 and organization_id = $3 returning *`,
    [revisionId, planId, organizationId]
  );
  return (rows[0] as PlanRevisionRow | undefined) ?? null;
}
