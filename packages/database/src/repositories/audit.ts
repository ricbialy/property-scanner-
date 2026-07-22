import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export async function recordAuditEvent(
  db: Queryable,
  input: {
    organizationId: string;
    actorType: "user" | "service" | "system";
    actorId?: string;
    action: string;
    subjectType: string;
    subjectId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `insert into audit_events (id, organization_id, actor_type, actor_id, action, subject_type, subject_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uuidv7(),
      input.organizationId,
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.subjectType,
      input.subjectId ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}
