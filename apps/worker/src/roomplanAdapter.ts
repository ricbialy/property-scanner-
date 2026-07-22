import { z } from "zod";

/**
 * Version-tolerant reader for the subset of RoomPlan's Codable export the
 * pipeline currently consumes. Unknown fields pass through untouched; missing
 * expected fields become validation findings, never silent drops.
 */
const surfaceSchema = z
  .object({
    identifier: z.string().uuid(),
    dimensions: z.array(z.number()).min(3),
    transform: z.array(z.number()).length(16).optional(),
    confidence: z.record(z.unknown()).optional(),
    parentIdentifier: z.string().uuid().nullable().optional()
  })
  .passthrough();

export const roomplanRoomSchema = z
  .object({
    version: z.number().int(),
    identifier: z.string().uuid(),
    walls: z.array(surfaceSchema).default([]),
    doors: z.array(surfaceSchema).default([]),
    windows: z.array(surfaceSchema).default([]),
    openings: z.array(surfaceSchema).default([]),
    floors: z.array(surfaceSchema).default([])
  })
  .passthrough();
export type RoomplanRoom = z.infer<typeof roomplanRoomSchema>;

export const roomplanStructureSchema = z
  .object({
    version: z.number().int(),
    identifier: z.string().uuid(),
    rooms: z.array(
      z
        .object({
          identifier: z.string().uuid(),
          transform: z.array(z.number()).length(16)
        })
        .passthrough()
    )
  })
  .passthrough();
export type RoomplanStructure = z.infer<typeof roomplanStructureSchema>;

/** Map RoomPlan's confidence enum-ish object to the platform confidence level. */
export function confidenceLevel(
  confidence: Record<string, unknown> | undefined
): "high" | "medium" | "low" | "unknown" {
  if (!confidence) return "unknown";
  if ("high" in confidence) return "high";
  if ("medium" in confidence) return "medium";
  if ("low" in confidence) return "low";
  return "unknown";
}
