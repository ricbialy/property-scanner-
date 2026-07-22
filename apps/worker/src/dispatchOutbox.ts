import { decryptSecret, listActiveWebhookEndpoints, uuidv7 } from "@propertyscan/database";
import { signWebhook, SIGNATURE_HEADER } from "@propertyscan/integration-studiokl";
import type { Logger } from "@propertyscan/observability";
import type pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 5000;

export interface DispatchDeps {
  pool: pg.Pool;
  log: Logger;
  masterKey: string;
  externalWebhooksDisabled: boolean;
}

/**
 * Transactional-outbox dispatcher: events appended alongside domain commits
 * are delivered to each organization's active webhook endpoints, signed over
 * the exact raw body (HMAC-SHA256 with timestamp + key id). Delivery is
 * at-least-once; consumers deduplicate by event id. Failed deliveries retry
 * with backoff up to MAX_DELIVERY_ATTEMPTS, then dead-letter.
 */
export async function dispatchOutbox(deps: DispatchDeps): Promise<number> {
  const { pool, log } = deps;
  let processed = 0;

  // New events.
  const { rows: events } = await pool.query(
    `select * from outbox_events where dispatched_at is null order by created_at limit 10`
  );
  for (const event of events) {
    const endpoints = await listActiveWebhookEndpoints(pool, event.organization_id);
    for (const endpoint of endpoints) {
      const deliveryId = uuidv7();
      await pool.query(
        `insert into webhook_deliveries (id, organization_id, webhook_endpoint_id, outbox_event_id, status, attempts)
         values ($1, $2, $3, $4, 'pending', 0)`,
        [deliveryId, event.organization_id, endpoint.id, event.id]
      );
    }
    await pool.query("update outbox_events set dispatched_at = now() where id = $1", [event.id]);
    processed += 1;
  }

  // Pending/retryable deliveries.
  const { rows: deliveries } = await pool.query(
    `select d.*, e.url, e.secret_encrypted, e.secret_key_id,
            o.event_type, o.resource_type, o.resource_id, o.payload, o.created_at as event_created_at
     from webhook_deliveries d
     join webhook_endpoints e on e.id = d.webhook_endpoint_id
     join outbox_events o on o.id = d.outbox_event_id
     where d.status in ('pending', 'failed')
       and d.attempts < $1
       and (d.next_attempt_at is null or d.next_attempt_at <= now())
     order by d.created_at
     limit 20`,
    [MAX_DELIVERY_ATTEMPTS]
  );

  for (const delivery of deliveries) {
    const url = new URL(delivery.url);
    if (deps.externalWebhooksDisabled && !LOCAL_HOSTS.has(url.hostname)) {
      await pool.query(
        `update webhook_deliveries set status = 'dead', last_error = 'external webhooks disabled', updated_at = now() where id = $1`,
        [delivery.id]
      );
      continue;
    }
    const envelope = {
      eventId: delivery.outbox_event_id,
      eventType: delivery.event_type,
      createdAt: new Date(delivery.event_created_at).toISOString(),
      organizationId: delivery.organization_id,
      apiVersion: "v1",
      resource: { type: delivery.resource_type, id: delivery.resource_id },
      payload: delivery.payload
    };
    const rawBody = JSON.stringify(envelope);
    const secret = decryptSecret(delivery.secret_encrypted, deps.masterKey);
    const signature = signWebhook(
      rawBody,
      secret,
      delivery.secret_key_id,
      Math.floor(Date.now() / 1000)
    );

    let outcome: { ok: boolean; error?: string };
    try {
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature },
        body: rawBody,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
      });
      outcome = response.ok
        ? { ok: true }
        : { ok: false, error: `endpoint responded ${response.status}` };
    } catch (error) {
      outcome = { ok: false, error: (error as Error).message };
    }

    if (outcome.ok) {
      await pool.query(
        "update webhook_deliveries set status = 'succeeded', attempts = attempts + 1, updated_at = now() where id = $1",
        [delivery.id]
      );
      log.info({ deliveryId: delivery.id, eventType: delivery.event_type }, "webhook delivered");
    } else {
      const attempts = delivery.attempts + 1;
      const status = attempts >= MAX_DELIVERY_ATTEMPTS ? "dead" : "failed";
      const backoffSeconds = Math.min(2 ** attempts * 10, 600);
      await pool.query(
        `update webhook_deliveries
         set status = $1, attempts = $2, last_error = $3,
             next_attempt_at = now() + make_interval(secs => $4), updated_at = now()
         where id = $5`,
        [status, attempts, outcome.error ?? "unknown", backoffSeconds, delivery.id]
      );
      log.warn(
        { deliveryId: delivery.id, attempts, error: outcome.error },
        "webhook delivery failed"
      );
    }
    processed += 1;
  }
  return processed;
}
