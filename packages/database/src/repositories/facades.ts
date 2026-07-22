import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface FacadeRow {
  id: string;
  organization_id: string;
  property_id: string;
  label: string;
  orientation_deg: number | null;
  notes: string | null;
  created_at: Date;
}

export interface FacadeOpeningRow {
  id: string;
  organization_id: string;
  facade_id: string;
  opening_type: "window" | "door" | "garage_door" | "vent" | "other";
  label: string | null;
  width_m: number | null;
  height_m: number | null;
  sill_height_m: number | null;
  linked_interior_opening_id: string | null;
  confidence: "high" | "medium" | "low" | "unknown";
  verification: "unverified" | "reviewed" | "field_verified" | "rejected";
  created_at: Date;
}

export async function createFacade(
  db: Queryable,
  organizationId: string,
  input: { propertyId: string; label: string; orientationDeg?: number; notes?: string }
): Promise<FacadeRow> {
  const { rows } = await db.query(
    `insert into facades (id, organization_id, property_id, label, orientation_deg, notes)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [
      uuidv7(),
      organizationId,
      input.propertyId,
      input.label,
      input.orientationDeg ?? null,
      input.notes ?? null
    ]
  );
  return rows[0] as FacadeRow;
}

export async function listFacades(
  db: Queryable,
  organizationId: string,
  propertyId: string
): Promise<FacadeRow[]> {
  const { rows } = await db.query(
    "select * from facades where property_id = $1 and organization_id = $2 order by id",
    [propertyId, organizationId]
  );
  return rows as FacadeRow[];
}

export async function findFacadeById(
  db: Queryable,
  organizationId: string,
  facadeId: string
): Promise<FacadeRow | null> {
  const { rows } = await db.query("select * from facades where id = $1 and organization_id = $2", [
    facadeId,
    organizationId
  ]);
  return (rows[0] as FacadeRow | undefined) ?? null;
}

export async function createFacadeOpening(
  db: Queryable,
  organizationId: string,
  input: {
    facadeId: string;
    openingType: FacadeOpeningRow["opening_type"];
    label?: string;
    widthM?: number;
    heightM?: number;
    sillHeightM?: number;
    linkedInteriorOpeningId?: string;
  }
): Promise<FacadeOpeningRow> {
  const { rows } = await db.query(
    `insert into facade_openings
       (id, organization_id, facade_id, opening_type, label, width_m, height_m, sill_height_m,
        linked_interior_opening_id, confidence)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unknown') returning *`,
    [
      uuidv7(),
      organizationId,
      input.facadeId,
      input.openingType,
      input.label ?? null,
      input.widthM ?? null,
      input.heightM ?? null,
      input.sillHeightM ?? null,
      input.linkedInteriorOpeningId ?? null
    ]
  );
  return rows[0] as FacadeOpeningRow;
}

export async function listFacadeOpenings(
  db: Queryable,
  organizationId: string,
  facadeId: string
): Promise<FacadeOpeningRow[]> {
  const { rows } = await db.query(
    "select * from facade_openings where facade_id = $1 and organization_id = $2 order by id",
    [facadeId, organizationId]
  );
  return rows as FacadeOpeningRow[];
}

export async function findFacadeOpeningById(
  db: Queryable,
  organizationId: string,
  openingId: string
): Promise<FacadeOpeningRow | null> {
  const { rows } = await db.query(
    "select * from facade_openings where id = $1 and organization_id = $2",
    [openingId, organizationId]
  );
  return (rows[0] as FacadeOpeningRow | undefined) ?? null;
}

/**
 * Apply a verified measurement to a facade opening's displayed dimension.
 * The measurement row itself (provenance) is stored separately; this only
 * denormalizes the latest value for display.
 */
export async function applyFacadeOpeningMeasurement(
  db: Queryable,
  organizationId: string,
  openingId: string,
  semanticType: "width" | "height" | "sill_height",
  valueM: number,
  verification: "reviewed" | "field_verified"
): Promise<void> {
  const column =
    semanticType === "width" ? "width_m" : semanticType === "height" ? "height_m" : "sill_height_m";
  await db.query(
    `update facade_openings set ${column} = $1, verification = $2 where id = $3 and organization_id = $4`,
    [valueM, verification, openingId, organizationId]
  );
}
