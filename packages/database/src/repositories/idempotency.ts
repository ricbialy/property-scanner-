import { createHash } from "node:crypto";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface IdempotencyRecord {
  id: string;
  organization_id: string;
  idempotency_key: string;
  endpoint: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex");
}

export async function findIdempotencyRecord(
  db: Queryable,
  organizationId: string,
  endpoint: string,
  key: string
): Promise<IdempotencyRecord | null> {
  const { rows } = await db.query(
    "select * from idempotency_keys where organization_id = $1 and endpoint = $2 and idempotency_key = $3",
    [organizationId, endpoint, key]
  );
  return (rows[0] as IdempotencyRecord | undefined) ?? null;
}

/**
 * Atomically reserve an idempotency key before running the creation handler,
 * so two concurrent same-key requests cannot both execute it. A row with a
 * null response_status is a pending reservation held by an in-flight request.
 */
export async function reserveIdempotencyKey(
  db: Queryable,
  input: {
    organizationId: string;
    endpoint: string;
    key: string;
    requestHash: string;
  }
): Promise<{ reserved: boolean; existing: IdempotencyRecord | null }> {
  const { rows } = await db.query(
    `insert into idempotency_keys
       (id, organization_id, endpoint, idempotency_key, request_hash)
     values ($1, $2, $3, $4, $5)
     on conflict (organization_id, endpoint, idempotency_key) do nothing
     returning *`,
    [uuidv7(), input.organizationId, input.endpoint, input.key, input.requestHash]
  );
  if (rows[0]) {
    return { reserved: true, existing: null };
  }
  const existing = await findIdempotencyRecord(db, input.organizationId, input.endpoint, input.key);
  return { reserved: false, existing };
}

export async function completeIdempotencyRecord(
  db: Queryable,
  input: {
    organizationId: string;
    endpoint: string;
    key: string;
    responseStatus: number;
    responseBody: unknown;
  }
): Promise<void> {
  await db.query(
    `update idempotency_keys
       set response_status = $4, response_body = $5
     where organization_id = $1 and endpoint = $2 and idempotency_key = $3`,
    [
      input.organizationId,
      input.endpoint,
      input.key,
      input.responseStatus,
      JSON.stringify(input.responseBody)
    ]
  );
}

/** Drop a pending reservation after a handler failure so a retry can execute. */
export async function releaseIdempotencyKey(
  db: Queryable,
  input: { organizationId: string; endpoint: string; key: string }
): Promise<void> {
  await db.query(
    `delete from idempotency_keys
     where organization_id = $1 and endpoint = $2 and idempotency_key = $3
       and response_status is null`,
    [input.organizationId, input.endpoint, input.key]
  );
}
