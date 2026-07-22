import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface FloorRow {
  id: string;
  organization_id: string;
  property_id: string;
  name: string;
  ordinal: number;
  elevation_m: number | null;
  display_units: "metric" | "imperial";
  created_at: Date;
}

export async function createFloor(
  db: Queryable,
  organizationId: string,
  input: { propertyId: string; name: string; ordinal: number; displayUnits: "metric" | "imperial" }
): Promise<FloorRow> {
  const { rows } = await db.query(
    `insert into floors (id, organization_id, property_id, name, ordinal, display_units)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [uuidv7(), organizationId, input.propertyId, input.name, input.ordinal, input.displayUnits]
  );
  return rows[0] as FloorRow;
}

export async function findFloorById(
  db: Queryable,
  organizationId: string,
  floorId: string
): Promise<FloorRow | null> {
  const { rows } = await db.query("select * from floors where id = $1 and organization_id = $2", [
    floorId,
    organizationId
  ]);
  return (rows[0] as FloorRow | undefined) ?? null;
}
