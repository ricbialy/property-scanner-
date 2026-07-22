import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFsStorage } from "./fsDriver.js";
import { assertValidObjectKey } from "./types.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-storage-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("fs storage driver", () => {
  it("round-trips objects", async () => {
    const storage = createFsStorage(root);
    const data = new TextEncoder().encode("hello");
    await storage.put("org/abc/captures/bundle.zip", data, "application/zip");
    expect(await storage.exists("org/abc/captures/bundle.zip")).toBe(true);
    expect(Buffer.from(await storage.get("org/abc/captures/bundle.zip")).toString()).toBe("hello");
    expect(await storage.exists("org/abc/other.zip")).toBe(false);
  });

  it("rejects traversal and malformed keys", async () => {
    const storage = createFsStorage(root);
    await expect(storage.put("../escape", new Uint8Array(), "text/plain")).rejects.toThrow();
    expect(() => assertValidObjectKey("a//b")).toThrow();
    expect(() => assertValidObjectKey("/absolute")).toThrow();
    expect(() => assertValidObjectKey("UPPER")).toThrow();
  });

  it("returns null upload URLs (API accepts local uploads directly)", async () => {
    const storage = createFsStorage(root);
    expect(await storage.createUploadUrl("k/v", "application/zip", 60)).toBeNull();
  });
});
