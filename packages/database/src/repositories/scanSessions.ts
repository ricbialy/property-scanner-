import type { ScanSessionStatus } from "@propertyscan/contracts";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface ScanSessionRow {
  id: string;
  organization_id: string;
  property_id: string;
  floor_id: string;
  capture_mode: "interior_roomplan" | "exterior_facade" | "opening_verification";
  status: ScanSessionStatus;
  requested_outputs: string[];
  external_references: Array<{ system: string; type: string; value: string }>;
  assigned_user_id: string | null;
  plan_id: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Legal lifecycle transitions (section 6.1 of the spec). */
const TRANSITIONS: Record<ScanSessionStatus, ScanSessionStatus[]> = {
  draft: ["capturing"],
  capturing: ["local_review", "capturing"],
  local_review: ["queued_upload"],
  queued_upload: ["uploading"],
  uploading: ["processing", "queued_upload"],
  processing: ["needs_review", "failed"],
  needs_review: ["completed"],
  failed: [],
  completed: []
};

export function isLegalTransition(from: ScanSessionStatus, to: ScanSessionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function createScanSession(
  db: Queryable,
  organizationId: string,
  input: {
    propertyId: string;
    floorId: string;
    captureMode?: "interior_roomplan" | "exterior_facade" | "opening_verification";
    requestedOutputs: string[];
    externalReferences: Array<{ system: string; type: string; value: string }>;
  }
): Promise<ScanSessionRow> {
  const { rows } = await db.query(
    `insert into scan_sessions (id, organization_id, property_id, floor_id, capture_mode, requested_outputs, external_references)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [
      uuidv7(),
      organizationId,
      input.propertyId,
      input.floorId,
      input.captureMode ?? "interior_roomplan",
      JSON.stringify(input.requestedOutputs),
      JSON.stringify(input.externalReferences)
    ]
  );
  return rows[0] as ScanSessionRow;
}

export async function findScanSessionById(
  db: Queryable,
  organizationId: string,
  scanSessionId: string
): Promise<ScanSessionRow | null> {
  const { rows } = await db.query(
    "select * from scan_sessions where id = $1 and organization_id = $2",
    [scanSessionId, organizationId]
  );
  return (rows[0] as ScanSessionRow | undefined) ?? null;
}

/**
 * Guarded status transition: the update applies only when the current status
 * still matches `from`, making concurrent transitions race-safe.
 */
export async function transitionScanSession(
  db: Queryable,
  organizationId: string,
  scanSessionId: string,
  from: ScanSessionStatus,
  to: ScanSessionStatus,
  extra?: { failureReason?: string; planId?: string }
): Promise<ScanSessionRow | null> {
  if (!isLegalTransition(from, to)) {
    throw new Error(`Illegal scan session transition ${from} -> ${to}`);
  }
  const { rows } = await db.query(
    `update scan_sessions
     set status = $1,
         failure_reason = coalesce($2, failure_reason),
         plan_id = coalesce($3, plan_id),
         updated_at = now()
     where id = $4 and organization_id = $5 and status = $6
     returning *`,
    [to, extra?.failureReason ?? null, extra?.planId ?? null, scanSessionId, organizationId, from]
  );
  return (rows[0] as ScanSessionRow | undefined) ?? null;
}
