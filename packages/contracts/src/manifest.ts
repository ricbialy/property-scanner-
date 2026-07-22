import { z } from "zod";

import { isoTimestampSchema, sha256HexSchema, uuidSchema } from "./common.js";

export const CAPTURE_MANIFEST_SCHEMA_VERSION = "1.0" as const;

export const manifestFileEntrySchema = z.object({
  /** Path relative to the bundle root, forward slashes, no leading slash. */
  path: z
    .string()
    .min(1)
    .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), {
      message: "path must be bundle-relative without traversal"
    }),
  byteSize: z.number().int().positive(),
  sha256: sha256HexSchema,
  contentType: z.string().min(1)
});
export type ManifestFileEntry = z.infer<typeof manifestFileEntrySchema>;

/**
 * Capture bundle manifest contract (manifest.json). Produced on-device.
 * Must never contain authentication tokens or credentials.
 */
export const captureManifestSchema = z
  .object({
    schemaVersion: z.literal(CAPTURE_MANIFEST_SCHEMA_VERSION),
    scanSessionId: uuidSchema,
    /** Client-generated ID that makes bundle upload idempotent per capture. */
    captureId: uuidSchema,
    device: z.object({
      model: z.string().min(1),
      osVersion: z.string().min(1),
      appVersion: z.string().min(1),
      lidar: z.boolean()
    }),
    units: z.literal("meters"),
    coordinateSystem: z.object({
      handedness: z.literal("right"),
      up: z.literal("+y"),
      transformSerialization: z.literal("column-major")
    }),
    capturedAt: z.object({
      startedAt: isoTimestampSchema,
      completedAt: isoTimestampSchema
    }),
    rooms: z
      .array(
        z.object({
          roomId: uuidSchema,
          name: z.string().max(120).optional(),
          roomplanFile: z.string().min(1)
        })
      )
      .min(1),
    structureFile: z.string().min(1).optional(),
    usdzFile: z.string().min(1).optional(),
    files: z.array(manifestFileEntrySchema).min(1)
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const paths = new Set(manifest.files.map((f) => f.path));
    if (paths.size !== manifest.files.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate file paths in manifest" });
    }
    for (const room of manifest.rooms) {
      if (!paths.has(room.roomplanFile)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `room ${room.roomId} references missing file ${room.roomplanFile}`
        });
      }
    }
    if (manifest.structureFile && !paths.has(manifest.structureFile)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "structureFile not present in files" });
    }
    if (manifest.usdzFile && !paths.has(manifest.usdzFile)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "usdzFile not present in files" });
    }
    const forbidden = ["token", "authorization", "secret"];
    const raw = JSON.stringify(manifest).toLowerCase();
    for (const word of forbidden) {
      if (raw.includes(`"${word}"`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `manifest must not contain credential-like field "${word}"`
        });
      }
    }
  });
export type CaptureManifest = z.infer<typeof captureManifestSchema>;
