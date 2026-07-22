import { createHash, randomBytes } from "node:crypto";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface HandoffTokenRow {
  id: string;
  organization_id: string;
  scan_session_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a short-lived opaque handoff token. The raw token is returned exactly
 * once for embedding in the deep link; only its SHA-256 hash is persisted.
 */
export async function issueHandoffToken(
  db: Queryable,
  organizationId: string,
  scanSessionId: string,
  ttlSeconds: number
): Promise<{ token: string; row: HandoffTokenRow }> {
  const token = `pshot_${randomBytes(32).toString("base64url")}`;
  const { rows } = await db.query(
    `insert into scan_handoff_tokens (id, organization_id, scan_session_id, token_hash, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5)) returning *`,
    [uuidv7(), organizationId, scanSessionId, hashToken(token), ttlSeconds]
  );
  return { token, row: rows[0] as HandoffTokenRow };
}

/** Redeem by raw token: valid when unexpired and unused. Marks single-use. */
export async function redeemHandoffToken(
  db: Queryable,
  token: string
): Promise<HandoffTokenRow | null> {
  const { rows } = await db.query(
    `update scan_handoff_tokens
     set used_at = now()
     where token_hash = $1 and used_at is null and expires_at > now()
     returning *`,
    [hashToken(token)]
  );
  return (rows[0] as HandoffTokenRow | undefined) ?? null;
}
