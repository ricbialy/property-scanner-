import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

/**
 * Transactional outbox: append events in the same transaction as the domain
 * commit; a dispatcher (worker) delivers them after the commit is durable.
 */
export async function appendOutboxEvent(
  db: Queryable,
  input: {
    organizationId: string;
    eventType: string;
    resourceType: string;
    resourceId: string;
    payload: Record<string, unknown>;
  }
): Promise<string> {
  const id = uuidv7();
  await db.query(
    `insert into outbox_events (id, organization_id, event_type, resource_type, resource_id, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      input.organizationId,
      input.eventType,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.payload)
    ]
  );
  return id;
}
