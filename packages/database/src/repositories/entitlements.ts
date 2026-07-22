import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export type EntitlementKey =
  | "interior_capture"
  | "exterior_capture"
  | "opening_verification"
  | "facade_auto_detection"
  | "photogrammetry_processing"
  | "advanced_exports"
  | "api_access";

/**
 * Defaults when no explicit row exists. Interior capture and API access are on
 * for every tenant; exterior capture and all dependent automation are OFF until
 * their acceptance gates are satisfied (amendment §15). Enforcement is
 * server-side — never only hidden UI.
 */
const DEFAULTS: Record<EntitlementKey, boolean> = {
  interior_capture: true,
  api_access: true,
  exterior_capture: false,
  opening_verification: false,
  facade_auto_detection: false,
  photogrammetry_processing: false,
  advanced_exports: false
};

export async function isEntitled(
  db: Queryable,
  organizationId: string,
  key: EntitlementKey
): Promise<boolean> {
  const { rows } = await db.query(
    "select enabled from entitlements where organization_id = $1 and entitlement_key = $2",
    [organizationId, key]
  );
  const row = rows[0] as { enabled: boolean } | undefined;
  return row ? row.enabled : DEFAULTS[key];
}

/** Grant/revoke explicitly; grantor identity is retained for auditability. */
export async function setEntitlement(
  db: Queryable,
  organizationId: string,
  key: EntitlementKey,
  enabled: boolean,
  grantedBy: string
): Promise<void> {
  await db.query(
    `insert into entitlements (id, organization_id, entitlement_key, enabled, granted_by)
     values ($1, $2, $3, $4, $5)
     on conflict (organization_id, entitlement_key)
     do update set enabled = $4, granted_by = $5, updated_at = now()`,
    [uuidv7(), organizationId, key, enabled, grantedBy]
  );
}
