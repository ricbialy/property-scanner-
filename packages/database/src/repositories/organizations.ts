import type { Role } from "@propertyscan/contracts";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface OrganizationRow {
  id: string;
  name: string;
  created_at: Date;
}

export interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: Role;
}

export async function createOrganizationWithOwner(
  db: Queryable,
  params: { name: string; ownerUserId: string }
): Promise<OrganizationRow> {
  const orgId = uuidv7();
  const { rows } = await db.query(
    "insert into organizations (id, name) values ($1, $2) returning *",
    [orgId, params.name]
  );
  await db.query(
    "insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')",
    [uuidv7(), orgId, params.ownerUserId]
  );
  return rows[0] as OrganizationRow;
}

/** Server-side membership resolution — the only path to a tenant context. */
export async function findMembership(
  db: Queryable,
  params: { userId: string; organizationId: string }
): Promise<MembershipRow | null> {
  const { rows } = await db.query(
    "select * from memberships where user_id = $1 and organization_id = $2",
    [params.userId, params.organizationId]
  );
  return (rows[0] as MembershipRow | undefined) ?? null;
}

export async function listOrganizationsForUser(
  db: Queryable,
  userId: string
): Promise<Array<OrganizationRow & { role: Role }>> {
  const { rows } = await db.query(
    `select o.*, m.role from organizations o
     join memberships m on m.organization_id = o.id
     where m.user_id = $1
     order by o.created_at`,
    [userId]
  );
  return rows as Array<OrganizationRow & { role: Role }>;
}
