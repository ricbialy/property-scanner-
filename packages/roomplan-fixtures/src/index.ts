import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";
import { captureManifestSchema, type CaptureManifest } from "@propertyscan/contracts";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

export const TWO_ROOM_FIXTURE = {
  kitchenRoomId: "5f3a1b2c-0001-4a00-9000-00000000a001",
  livingRoomId: "5f3a1b2c-0002-4a00-9000-00000000a002",
  /** Deterministic capture id so repeated imports are recognizably idempotent. */
  captureId: "5f3a1b2c-aaaa-4a00-9000-00000000ffff"
} as const;

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface FixtureBundle {
  manifest: CaptureManifest;
  /** Zip archive of the capture bundle, manifest.json included. */
  zip: Uint8Array;
}

/**
 * Assemble the deterministic two-room capture bundle for a given scan session.
 * File hashes in the manifest are computed from the real fixture bytes, so the
 * import pipeline's checksum verification is exercised genuinely.
 */
export function buildFixtureBundle(
  scanSessionId: string,
  options?: { captureId?: string; corruptChecksums?: boolean }
): FixtureBundle {
  const encoder = new TextEncoder();
  const filePaths = [
    "roomplan/room-5f3a1b2c-0001-4a00-9000-00000000a001.json",
    "roomplan/room-5f3a1b2c-0002-4a00-9000-00000000a002.json",
    "roomplan/structure.json"
  ] as const;
  const sources = [
    join(fixturesRoot, "two-room/roomplan/room-kitchen.json"),
    join(fixturesRoot, "two-room/roomplan/room-living.json"),
    join(fixturesRoot, "two-room/roomplan/structure.json")
  ];

  const contents = sources.map((p) => new Uint8Array(readFileSync(p)));

  const manifest: CaptureManifest = captureManifestSchema.parse({
    schemaVersion: "1.0",
    scanSessionId,
    captureId: options?.captureId ?? TWO_ROOM_FIXTURE.captureId,
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
      { roomId: TWO_ROOM_FIXTURE.kitchenRoomId, name: "Kitchen", roomplanFile: filePaths[0] },
      { roomId: TWO_ROOM_FIXTURE.livingRoomId, name: "Living Room", roomplanFile: filePaths[1] }
    ],
    structureFile: filePaths[2],
    files: filePaths.map((path, i) => ({
      path,
      byteSize: contents[i]!.byteLength,
      sha256: options?.corruptChecksums ? "0".repeat(64) : sha256(contents[i]!),
      contentType: "application/json"
    }))
  });

  const entries: Record<string, Uint8Array> = {
    "manifest.json": encoder.encode(JSON.stringify(manifest, null, 2))
  };
  filePaths.forEach((path, i) => {
    entries[path] = contents[i]!;
  });

  // level 0 keeps output deterministic across fflate versions; mtime fixed by fflate default (0).
  const zip = zipSync(entries, { level: 0 });
  return { manifest, zip };
}
