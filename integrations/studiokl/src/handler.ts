import { webhookEnvelopeSchema, type WebhookEnvelope } from "./webhook.js";

/**
 * Idempotent event-handler example. Delivery is at-least-once, so StudioKL
 * must deduplicate by eventId before acting. `SeenEventStore` would be a
 * database table in a real deployment.
 */
export interface SeenEventStore {
  hasSeen(eventId: string): Promise<boolean>;
  markSeen(eventId: string): Promise<void>;
}

export function createInMemorySeenEventStore(): SeenEventStore {
  const seen = new Set<string>();
  return {
    async hasSeen(eventId) {
      return seen.has(eventId);
    },
    async markSeen(eventId) {
      seen.add(eventId);
    }
  };
}

export type EventAction = (envelope: WebhookEnvelope) => Promise<void>;

export async function handleWebhookEvent(
  rawBody: string,
  store: SeenEventStore,
  actions: Partial<Record<WebhookEnvelope["eventType"], EventAction>>
): Promise<{ status: "processed" | "duplicate" | "ignored" | "invalid"; eventId?: string }> {
  const parsed = webhookEnvelopeSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) {
    return { status: "invalid" };
  }
  const envelope = parsed.data;
  if (await store.hasSeen(envelope.eventId)) {
    return { status: "duplicate", eventId: envelope.eventId };
  }
  await store.markSeen(envelope.eventId);
  const action = actions[envelope.eventType];
  if (!action) {
    return { status: "ignored", eventId: envelope.eventId };
  }
  await action(envelope);
  return { status: "processed", eventId: envelope.eventId };
}
