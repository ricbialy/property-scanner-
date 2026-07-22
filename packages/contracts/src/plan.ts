import { z } from "zod";

import {
  confidenceLevelSchema,
  isoTimestampSchema,
  measurementSourceSchema,
  measurementVerificationSchema,
  openingTypeSchema,
  uuidSchema
} from "./common.js";

export const GEOMETRY_SCHEMA_VERSION = "0.1" as const;

/**
 * Marker for data the pipeline has not normalized yet. Fields carrying this value
 * are explicit about being unprocessed rather than silently absent or faked.
 */
export const NOT_PROCESSED = "not_processed" as const;
export const notProcessedSchema = z.literal(NOT_PROCESSED);

const point2Schema = z.object({ x: z.number(), y: z.number() });

export const planRoomSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  sourceRoomId: uuidSchema,
  /** CCW polygon in floor-local meters, or not_processed until normalization lands. */
  boundary: z.union([z.array(point2Schema).min(3), notProcessedSchema]),
  areaM2: z.union([z.number().positive(), notProcessedSchema]),
  confidence: confidenceLevelSchema
});

export const planWallSchema = z.object({
  id: uuidSchema,
  roomId: uuidSchema,
  start: z.union([point2Schema, notProcessedSchema]),
  end: z.union([point2Schema, notProcessedSchema]),
  thicknessM: z.number().positive().nullable(),
  heightM: z.number().positive().nullable(),
  source: measurementSourceSchema,
  confidence: confidenceLevelSchema
});

export const planOpeningSchema = z.object({
  id: uuidSchema,
  type: openingTypeSchema,
  wallId: uuidSchema.nullable(),
  offsetAlongWallM: z.union([z.number(), notProcessedSchema]),
  widthM: z.union([z.number().positive(), notProcessedSchema]),
  heightM: z.union([z.number().positive(), notProcessedSchema]),
  sillHeightM: z.union([z.number(), notProcessedSchema]).nullable(),
  roomIds: z.array(uuidSchema),
  confidence: confidenceLevelSchema,
  verification: measurementVerificationSchema
});

export const validationFindingSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  subjectType: z.string().optional(),
  subjectId: z.string().optional()
});
export type ValidationFinding = z.infer<typeof validationFindingSchema>;

/** Normalized plan revision payload — the canonical JSON projection of a revision. */
export const planRevisionPayloadSchema = z.object({
  schemaVersion: z.literal(GEOMETRY_SCHEMA_VERSION),
  planId: uuidSchema,
  revisionId: uuidSchema,
  coordinateConventions: z.object({
    units: z.literal("meters"),
    plan: z.literal("x-z-projection"),
    winding: z.literal("ccw"),
    angles: z.literal("radians")
  }),
  rooms: z.array(planRoomSchema),
  walls: z.array(planWallSchema),
  openings: z.array(planOpeningSchema),
  validationFindings: z.array(validationFindingSchema)
});
export type PlanRevisionPayload = z.infer<typeof planRevisionPayloadSchema>;

export const planRevisionSchema = z.object({
  id: uuidSchema,
  planId: uuidSchema,
  parentRevisionId: uuidSchema.nullable(),
  authorType: z.enum(["import", "user", "system"]),
  reason: z.string(),
  status: z.enum(["draft", "accepted", "superseded"]),
  version: z.number().int().positive(),
  payload: planRevisionPayloadSchema,
  createdAt: isoTimestampSchema
});
export type PlanRevision = z.infer<typeof planRevisionSchema>;

export const planSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  floorId: uuidSchema,
  scanSessionId: uuidSchema.nullable(),
  currentRevisionId: uuidSchema.nullable(),
  createdAt: isoTimestampSchema
});
export type Plan = z.infer<typeof planSchema>;
