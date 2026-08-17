import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface WebhookEndpointRow {
  id: string;
  organization_id: string;
  url: string;
  secret_encrypted: string;
  secret_key_id: string;
  active: boolean;
  created_at: Date;
}

/** AES-256-GCM with a key derived from the master encryption key. */
function derivedKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}

export function encryptSecret(secret: string, masterKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(masterKey), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string, masterKey: string): string {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) {
    throw new Error("malformed encrypted secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derivedKey(masterKey),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export async function createWebhookEndpoint(
  db: Queryable,
  organizationId: string,
  input: { url: string; secret: string; masterKey: string; keyId?: string }
): Promise<WebhookEndpointRow> {
  const { rows } = await db.query(
    `insert into webhook_endpoints (id, organization_id, url, secret_encrypted, secret_key_id)
     values ($1, $2, $3, $4, $5) returning *`,
    [
      uuidv7(),
      organizationId,
      input.url,
      encryptSecret(input.secret, input.masterKey),
      input.keyId ?? "k1"
    ]
  );
  return rows[0] as WebhookEndpointRow;
}

export async function listActiveWebhookEndpoints(
  db: Queryable,
  organizationId: string
): Promise<WebhookEndpointRow[]> {
  const { rows } = await db.query(
    "select * from webhook_endpoints where organization_id = $1 and active order by id",
    [organizationId]
  );
  return rows as WebhookEndpointRow[];
}
