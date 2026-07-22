import { createHash } from "node:crypto";

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildFixtureBundle, TWO_ROOM_FIXTURE } from "./index.js";

const SESSION_ID = "0198a2b4-1111-7000-8000-000000000001";

describe("buildFixtureBundle", () => {
  it("produces a bundle whose manifest hashes match the zipped bytes", () => {
    const { manifest, zip } = buildFixtureBundle(SESSION_ID);
    const files = unzipSync(zip);

    expect(manifest.scanSessionId).toBe(SESSION_ID);
    expect(manifest.captureId).toBe(TWO_ROOM_FIXTURE.captureId);
    expect(manifest.rooms).toHaveLength(2);

    for (const entry of manifest.files) {
      const data = files[entry.path];
      expect(data, `missing ${entry.path}`).toBeDefined();
      expect(data!.byteLength).toBe(entry.byteSize);
      const digest = createHash("sha256").update(data!).digest("hex");
      expect(digest).toBe(entry.sha256);
    }
  });

  it("is deterministic for the same session", () => {
    const a = buildFixtureBundle(SESSION_ID);
    const b = buildFixtureBundle(SESSION_ID);
    expect(Buffer.from(a.zip).equals(Buffer.from(b.zip))).toBe(true);
  });

  it("can produce deliberately corrupted checksums for negative tests", () => {
    const { manifest } = buildFixtureBundle(SESSION_ID, { corruptChecksums: true });
    expect(manifest.files.every((f) => f.sha256 === "0".repeat(64))).toBe(true);
  });
});
