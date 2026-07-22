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

export async function insertRoomStub(
  db: Queryable,
  organizationId: string,
  input: {
    id: string;
    planRevisionId: string;
    sourceRoomId: string;
    name: string | null;
    confidence: "high" | "medium" | "low" | "unknown";
  }
): Promise<void> {
  await db.query(
    `insert into rooms (id, organization_id, plan_revision_id, source_room_id, name, confidence)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      organizationId,
      input.planRevisionId,
      input.sourceRoomId,
      input.name,
      input.confidence
    ]
  );
}
