import type { CreatePropertyRequest } from "@propertyscan/contracts";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface PropertyRow {
  id: string;
  organization_id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  external_references: Array<{ system: string; type: string; value: string }>;
  created_at: Date;
}

export async function createProperty(
  db: Queryable,
  organizationId: string,
  input: CreatePropertyRequest
): Promise<PropertyRow> {
  const { rows } = await db.query(
    `insert into properties
       (id, organization_id, name, address_line1, address_line2, city, region, postal_code, country, external_references)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      uuidv7(),
      organizationId,
      input.name,
      input.addressLine1 ?? null,
      input.addressLine2 ?? null,
      input.city ?? null,
      input.region ?? null,
      input.postalCode ?? null,
      input.country ?? null,
      JSON.stringify(input.externalReferences ?? [])
    ]
  );
  return rows[0] as PropertyRow;
}

export async function findPropertyById(
  db: Queryable,
  organizationId: string,
  propertyId: string
): Promise<PropertyRow | null> {
  const { rows } = await db.query(
    "select * from properties where id = $1 and organization_id = $2",
    [propertyId, organizationId]
  );
  return (rows[0] as PropertyRow | undefined) ?? null;
}

export async function listProperties(
  db: Queryable,
  organizationId: string,
  params: { limit: number; cursor?: string }
): Promise<PropertyRow[]> {
  if (params.cursor) {
    const { rows } = await db.query(
      "select * from properties where organization_id = $1 and id > $2 order by id limit $3",
      [organizationId, params.cursor, params.limit]
    );
    return rows as PropertyRow[];
  }
  const { rows } = await db.query(
    "select * from properties where organization_id = $1 order by id limit $2",
    [organizationId, params.limit]
  );
  return rows as PropertyRow[];
}
