import { describe, expect, it } from "vitest";

import { captureManifestSchema } from "./manifest.js";

const validManifest = {
  schemaVersion: "1.0",
  scanSessionId: "0198a2b4-1111-7000-8000-000000000001",
  captureId: "0198a2b4-2222-7000-8000-000000000002",
  device: { model: "iPhone16,1", osVersion: "18.5", appVersion: "0.1.0", lidar: true },
  units: "meters",
  coordinateSystem: {
    handedness: "right",
    up: "+y",
    transformSerialization: "column-major"
  },
  capturedAt: {
    startedAt: "2026-07-20T14:03:00Z",
    completedAt: "2026-07-20T14:11:30Z"
  },
  rooms: [
    {
      roomId: "0198a2b4-3333-7000-8000-000000000003",
      name: "Kitchen",
      roomplanFile: "roomplan/room-0198a2b4-3333-7000-8000-000000000003.json"
    }
  ],
  files: [
    {
      path: "roomplan/room-0198a2b4-3333-7000-8000-000000000003.json",
      byteSize: 2048,
      sha256: "a".repeat(64),
      contentType: "application/json"
    }
  ]
};

describe("captureManifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(captureManifestSchema.parse(validManifest).captureId).toBe(validManifest.captureId);
  });

  it("rejects rooms referencing files missing from the file list", () => {
    const bad = {
      ...validManifest,
      rooms: [{ ...validManifest.rooms[0], roomplanFile: "roomplan/missing.json" }]
    };
    expect(() => captureManifestSchema.parse(bad)).toThrow(/missing file/);
  });

  it("rejects path traversal", () => {
    const bad = {
      ...validManifest,
      files: [{ ...validManifest.files[0], path: "../../etc/passwd" }],
      rooms: [{ ...validManifest.rooms[0], roomplanFile: "../../etc/passwd" }]
    };
    expect(() => captureManifestSchema.parse(bad)).toThrow(/traversal/);
  });

  it("rejects duplicate file paths", () => {
    const bad = { ...validManifest, files: [validManifest.files[0], validManifest.files[0]] };
    expect(() => captureManifestSchema.parse(bad)).toThrow(/duplicate/);
  });

  it("rejects credential-like fields", () => {
    const bad = { ...validManifest, token: "secret" };
    expect(() => captureManifestSchema.parse(bad)).toThrow();
  });
});
