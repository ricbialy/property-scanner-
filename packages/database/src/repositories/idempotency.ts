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

export async function storeIdempotencyRecord(
  db: Queryable,
  input: {
    organizationId: string;
    endpoint: string;
    key: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }
): Promise<void> {
  await db.query(
    `insert into idempotency_keys
       (id, organization_id, endpoint, idempotency_key, request_hash, response_status, response_body)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, endpoint, idempotency_key) do nothing`,
    [
      uuidv7(),
      input.organizationId,
      input.endpoint,
      input.key,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.responseBody)
    ]
  );
}
