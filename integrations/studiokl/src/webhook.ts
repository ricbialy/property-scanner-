import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** Webhook envelope contract (spec §12.2). */
export const webhookEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.enum([
    "scan.processing",
    "scan.needs_review",
    "scan.failed",
    "plan.accepted",
    "exports.ready"
  ]),
  createdAt: z.string().datetime({ offset: true }),
  organizationId: z.string().uuid(),
  apiVersion: z.literal("v1"),
  resource: z.object({ type: z.string(), id: z.string().uuid() }),
  payload: z.record(z.unknown())
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export const SIGNATURE_HEADER = "propertyscan-signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Sign the exact raw body: `t=<unix>,k=<keyId>,v1=<hex hmac of "<t>.<body>">`.
 * Consumers must verify against the raw bytes, never a re-serialized object.
 */
export function signWebhook(
  rawBody: string,
  secret: string,
  keyId: string,
  timestamp: number
): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},k=${keyId},v1=${mac}`;
}

export interface VerifyOptions {
  /** Secrets by key id — supports rotation by keeping the old key during overlap. */
  secretsByKeyId: Record<string, string>;
  toleranceSeconds?: number;
  now?: number;
}

export type VerifyResult =
  | { ok: true; keyId: string; timestamp: number }
  | { ok: false; reason: "malformed" | "unknown_key" | "stale_timestamp" | "signature_mismatch" };

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  options: VerifyOptions
): VerifyResult {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const idx = part.indexOf("=");
      return [part.slice(0, idx), part.slice(idx + 1)];
    })
  ) as Record<string, string>;
  const timestamp = Number(parts["t"]);
  const keyId = parts["k"];
  const signature = parts["v1"];
  if (!Number.isFinite(timestamp) || !keyId || !signature) {
    return { ok: false, reason: "malformed" };
  }
  const secret = options.secretsByKeyId[keyId];
  if (!secret) {
    return { ok: false, reason: "unknown_key" };
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const provided = Buffer.from(signature, "hex");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true, keyId, timestamp };
}
