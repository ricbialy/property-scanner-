import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface MeasurementRow {
  id: string;
  organization_id: string;
  subject_type: string;
  subject_id: string;
  value: number;
  unit: string;
  semantic_type: string;
  source: "roomplan" | "manual" | "laser" | "derived";
  captured_by: string | null;
  captured_at: Date | null;
  uncertainty_m: number | null;
  verification: "unverified" | "reviewed" | "field_verified" | "rejected";
  supersedes_id: string | null;
  notes: string | null;
  created_at: Date;
}

/**
 * Record a measurement with full provenance. Never mutates an existing
 * measurement: superseding values reference their predecessor (spec §7.4).
 * field_verified requires an identified user, timestamp, and manual/laser source.
 */
export async function recordMeasurement(
  db: Queryable,
  organizationId: string,
  input: {
    subjectType: string;
    subjectId: string;
    value: number;
    unit: string;
    semanticType: string;
    source: "roomplan" | "manual" | "laser" | "derived";
    capturedBy?: string;
    capturedAt?: Date;
    uncertaintyM?: number;
    verification: "unverified" | "reviewed" | "field_verified";
    supersedesId?: string;
    notes?: string;
    planRevisionId?: string;
  }
): Promise<MeasurementRow> {
  if (input.verification === "field_verified") {
    if (!input.capturedBy || !input.capturedAt || !["manual", "laser"].includes(input.source)) {
      throw new Error(
        "field_verified measurements require capturedBy, capturedAt, and a manual or laser source"
      );
    }
  }
  const { rows } = await db.query(
    `insert into measurements
       (id, organization_id, plan_revision_id, subject_type, subject_id, value, unit, semantic_type,
        source, captured_by, captured_at, uncertainty_m, verification, supersedes_id, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning *`,
    [
      uuidv7(),
      organizationId,
      input.planRevisionId ?? null,
      input.subjectType,
      input.subjectId,
      input.value,
      input.unit,
      input.semanticType,
      input.source,
      input.capturedBy ?? null,
      input.capturedAt ?? null,
      input.uncertaintyM ?? null,
      input.verification,
      input.supersedesId ?? null,
      input.notes ?? null
    ]
  );
  return rows[0] as MeasurementRow;
}

export async function listMeasurementsForSubject(
  db: Queryable,
  organizationId: string,
  subjectType: string,
  subjectId: string
): Promise<MeasurementRow[]> {
  const { rows } = await db.query(
    `select * from measurements
     where organization_id = $1 and subject_type = $2 and subject_id = $3
     order by created_at`,
    [organizationId, subjectType, subjectId]
  );
  return rows as MeasurementRow[];
}
