import { z } from "zod";

import { openingTypeSchema, uuidSchema } from "./common.js";

/**
 * Typed correction commands (spec §10.2). The browser never submits
 * replacement JSON; it submits commands which the server validates and
 * reduces into a new immutable draft revision.
 */
export const planCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("renameRoom"),
    roomId: uuidSchema,
    name: z.string().min(1).max(120)
  }),
  z.object({
    type: z.literal("updateOpening"),
    openingId: uuidSchema,
    patch: z
      .object({
        openingType: openingTypeSchema.optional(),
        widthM: z.number().positive().max(30).optional(),
        heightM: z.number().positive().max(30).optional(),
        sillHeightM: z.number().min(0).max(30).nullable().optional(),
        wallId: uuidSchema.nullable().optional(),
        offsetAlongWallM: z.number().optional()
      })
      .refine((p) => Object.keys(p).length > 0, { message: "empty patch" })
  }),
  z.object({
    type: z.literal("addOpening"),
    opening: z.object({
      openingType: openingTypeSchema,
      wallId: uuidSchema.nullable(),
      roomIds: z.array(uuidSchema).min(1),
      widthM: z.number().positive().max(30),
      heightM: z.number().positive().max(30),
      sillHeightM: z.number().min(0).max(30).nullable(),
      offsetAlongWallM: z.number().optional()
    })
  }),
  z.object({
    type: z.literal("removeOpening"),
    openingId: uuidSchema,
    reason: z.string().max(500).optional()
  }),
  /**
   * Field verification: corrected dimensions with provenance. Creates
   * measurement records and marks the opening field_verified.
   */
  z.object({
    type: z.literal("verifyOpening"),
    openingId: uuidSchema,
    source: z.enum(["manual", "laser"]),
    widthM: z.number().positive().max(30).optional(),
    heightM: z.number().positive().max(30).optional(),
    sillHeightM: z.number().min(0).max(30).optional()
  })
]);
export type PlanCommand = z.infer<typeof planCommandSchema>;

export const createRevisionRequestSchema = z.object({
  /** Optimistic concurrency: must match the plan's current revision. */
  parentRevisionId: uuidSchema,
  reason: z.string().min(1).max(500),
  commands: z.array(planCommandSchema).min(1).max(200)
});
export type CreateRevisionRequest = z.infer<typeof createRevisionRequestSchema>;
