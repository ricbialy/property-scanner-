import { describe, expect, it } from "vitest";

import { createInMemorySeenEventStore, handleWebhookEvent } from "./handler.js";
import { signWebhook, verifyWebhookSignature } from "./webhook.js";

const secret = "whsec_test_secret";
const keyId = "key_1";
const now = 1_800_000_000;

const envelope = {
  eventId: "0198a2b4-9999-7000-8000-00000000e001",
  eventType: "plan.accepted",
  createdAt: "2026-07-21T12:00:00Z",
  organizationId: "0198a2b4-8888-7000-8000-00000000a001",
  apiVersion: "v1",
  resource: { type: "plan", id: "0198a2b4-7777-7000-8000-00000000b001" },
  payload: { planId: "0198a2b4-7777-7000-8000-00000000b001" }
};
const rawBody = JSON.stringify(envelope);

describe("webhook signing and verification", () => {
  it("round-trips a valid signature", () => {
    const header = signWebhook(rawBody, secret, keyId, now);
    const result = verifyWebhookSignature(rawBody, header, {
      secretsByKeyId: { [keyId]: secret },
      now
    });
    expect(result).toEqual({ ok: true, keyId, timestamp: now });
  });

  it("rejects tampered bodies", () => {
    const header = signWebhook(rawBody, secret, keyId, now);
    const tampered = rawBody.replace("plan.accepted", "scan.failed");
    expect(
      verifyWebhookSignature(tampered, header, { secretsByKeyId: { [keyId]: secret }, now })
    ).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects replays outside the tolerance window", () => {
    const header = signWebhook(rawBody, secret, keyId, now - 3600);
    expect(
      verifyWebhookSignature(rawBody, header, { secretsByKeyId: { [keyId]: secret }, now })
    ).toMatchObject({ ok: false, reason: "stale_timestamp" });
  });

  it("supports secret rotation via key ids and rejects unknown keys", () => {
    const rotated = signWebhook(rawBody, "new_secret", "key_2", now);
    expect(
      verifyWebhookSignature(rawBody, rotated, {
        secretsByKeyId: { key_1: secret, key_2: "new_secret" },
        now
      })
    ).toMatchObject({ ok: true, keyId: "key_2" });
    expect(
      verifyWebhookSignature(rawBody, rotated, { secretsByKeyId: { key_1: secret }, now })
    ).toMatchObject({ ok: false, reason: "unknown_key" });
  });

  it("rejects malformed headers", () => {
    expect(
      verifyWebhookSignature(rawBody, "nonsense", { secretsByKeyId: { [keyId]: secret }, now })
    ).toMatchObject({ ok: false, reason: "malformed" });
  });
});

describe("idempotent event handling", () => {
  it("processes once and deduplicates redelivery by event id", async () => {
    const store = createInMemorySeenEventStore();
    let handled = 0;
    const actions = {
      "plan.accepted": async () => {
        handled += 1;
      }
    } as const;

    expect((await handleWebhookEvent(rawBody, store, actions)).status).toBe("processed");
    expect((await handleWebhookEvent(rawBody, store, actions)).status).toBe("duplicate");
    expect(handled).toBe(1);
  });

  it("flags invalid envelopes", async () => {
    const store = createInMemorySeenEventStore();
    expect((await handleWebhookEvent(JSON.stringify({ nope: true }), store, {})).status).toBe(
      "invalid"
    );
  });
});
