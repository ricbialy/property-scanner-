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
 * Fixture variants for the import test matrix (spec §15.1):
 * - `two-room`: multiroom aligned via structure.json (default);
 * - `single-room`: one room, no structure result;
 * - `missing-wall`: the kitchen with one wall removed, so the room boundary
 *   cannot close and the pipeline must emit a finding instead of geometry;
 * - `unsupported-schema`: a manifest declaring a future schema version the
 *   importer must reject cleanly.
 */
export type FixtureVariant =
  "two-room" | "single-room" | "missing-wall" | "unsupported-schema" | "duplicate-opening";

export interface FixtureOptions {
  captureId?: string;
  corruptChecksums?: boolean;
  variant?: FixtureVariant;
}

/**
 * Assemble a deterministic capture bundle for a given scan session. File
 * hashes in the manifest are computed from the real bytes, so the import
 * pipeline's checksum verification is exercised genuinely.
 */
export function buildFixtureBundle(scanSessionId: string, options?: FixtureOptions): FixtureBundle {
  const encoder = new TextEncoder();
  const variant = options?.variant ?? "two-room";

  const kitchenPath = "roomplan/room-5f3a1b2c-0001-4a00-9000-00000000a001.json";
  const livingPath = "roomplan/room-5f3a1b2c-0002-4a00-9000-00000000a002.json";
  const structurePath = "roomplan/structure.json";

  let kitchenBytes = new Uint8Array(
    readFileSync(join(fixturesRoot, "two-room/roomplan/room-kitchen.json"))
  );
  if (variant === "missing-wall") {
    const room = JSON.parse(new TextDecoder().decode(kitchenBytes)) as { walls: unknown[] };
    room.walls = room.walls.slice(0, 3);
    kitchenBytes = encoder.encode(JSON.stringify(room, null, 2));
  }
  if (variant === "duplicate-opening") {
    // RoomPlan sometimes yields the same physical door twice; clone the
    // kitchen door with a new identifier at the same transform.
    const room = JSON.parse(new TextDecoder().decode(kitchenBytes)) as {
      doors: Array<Record<string, unknown>>;
    };
    room.doors.push({
      ...room.doors[0]!,
      identifier: "5f3a1b2c-3002-4a00-9000-00000000d002"
    });
    kitchenBytes = encoder.encode(JSON.stringify(room, null, 2));
  }

  const multiroom = variant === "two-room" || variant === "unsupported-schema";
  const files: Array<{ path: string; bytes: Uint8Array }> = [
    { path: kitchenPath, bytes: kitchenBytes }
  ];
  if (multiroom) {
    files.push(
      {
        path: livingPath,
        bytes: new Uint8Array(
          readFileSync(join(fixturesRoot, "two-room/roomplan/room-living.json"))
        )
      },
      {
        path: structurePath,
        bytes: new Uint8Array(readFileSync(join(fixturesRoot, "two-room/roomplan/structure.json")))
      }
    );
  }

  const rooms = [
    { roomId: TWO_ROOM_FIXTURE.kitchenRoomId, name: "Kitchen", roomplanFile: kitchenPath },
    ...(multiroom
      ? [{ roomId: TWO_ROOM_FIXTURE.livingRoomId, name: "Living Room", roomplanFile: livingPath }]
      : [])
  ];

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
    rooms,
    ...(multiroom ? { structureFile: structurePath } : {}),
    files: files.map((f) => ({
      path: f.path,
      byteSize: f.bytes.byteLength,
      sha256: options?.corruptChecksums ? "0".repeat(64) : sha256(f.bytes),
      contentType: "application/json"
    }))
  });

  // The unsupported-schema variant declares a future version AFTER validation,
  // producing bytes the importer must reject at its own schema gate.
  const manifestForZip: Record<string, unknown> = { ...manifest };
  if (variant === "unsupported-schema") {
    manifestForZip["schemaVersion"] = "99.0";
  }

  const entries: Record<string, Uint8Array> = {
    "manifest.json": encoder.encode(JSON.stringify(manifestForZip, null, 2))
  };
  for (const f of files) {
    entries[f.path] = f.bytes;
  }

  // level 0 keeps output deterministic across fflate versions; mtime fixed by fflate default (0).
  const zip = zipSync(entries, { level: 0 });
  return { manifest, zip };
}
