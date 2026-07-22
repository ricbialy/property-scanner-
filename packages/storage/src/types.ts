/**
 * Object storage abstraction. Object keys are always chosen server-side;
 * clients never influence key layout. Raw capture artifacts are immutable —
 * `put` on an existing key is an error for artifact prefixes at the caller level.
 */
export interface ObjectStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  /**
   * Where the client should upload bytes for this key.
   * S3 driver: short-lived presigned PUT URL.
   * fs driver: null — the API accepts the bytes on its local upload endpoint.
   */
  createUploadUrl(key: string, contentType: string, expiresSeconds: number): Promise<string | null>;
  /**
   * Short-lived signed download URL. S3 driver: presigned GET; fs driver:
   * null — the API streams the bytes itself behind authorization.
   */
  createDownloadUrl(key: string, expiresSeconds: number): Promise<string | null>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,511}$/;

export function assertValidObjectKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Invalid object key: ${key}`);
  }
}
