import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, "lowercase hex SHA-256");

/** RFC 9457 Problem Details. All API errors use application/problem+json. */
export const problemDetailsSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional()
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const scanSessionStatusSchema = z.enum([
  "draft",
  "capturing",
  "local_review",
  "queued_upload",
  "uploading",
  "processing",
  "needs_review",
  "failed",
  "completed"
]);
export type ScanSessionStatus = z.infer<typeof scanSessionStatusSchema>;

export const measurementSourceSchema = z.enum(["roomplan", "manual", "laser", "derived"]);
export const measurementVerificationSchema = z.enum([
  "unverified",
  "reviewed",
  "field_verified",
  "rejected"
]);
export const confidenceLevelSchema = z.enum(["high", "medium", "low", "unknown"]);
export const openingTypeSchema = z.enum(["window", "door", "open_passage", "unknown"]);

/** Capture modes (exterior amendment §7.1). Interior RoomPlan is the default. */
export const captureModeSchema = z.enum([
  "interior_roomplan",
  "exterior_facade",
  "opening_verification"
]);
export type CaptureMode = z.infer<typeof captureModeSchema>;

/**
 * Reserved exterior enums (amendment §7.6). Contract-level reservations only —
 * no detector, no exterior reconstruction, no completion claim. Phase 7 work.
 */
export const exteriorOpeningTypeSchema = z.enum([
  "window",
  "exterior_door",
  "garage_door",
  "open_passage",
  "storefront",
  "vent",
  "unknown"
]);
export type ExteriorOpeningType = z.infer<typeof exteriorOpeningTypeSchema>;

export const detectionStateSchema = z.enum([
  "suspected",
  "visually_detected",
  "geometry_confirmed",
  "user_confirmed",
  "field_verified",
  "rejected"
]);
export type DetectionState = z.infer<typeof detectionStateSchema>;

export const occlusionStateSchema = z.enum(["none", "partial", "severe", "unknown"]);
export type OcclusionState = z.infer<typeof occlusionStateSchema>;

export const entitlementKeySchema = z.enum([
  "interior_capture",
  "exterior_capture",
  "opening_verification",
  "facade_auto_detection",
  "photogrammetry_processing",
  "advanced_exports",
  "api_access"
]);
export type EntitlementKeyContract = z.infer<typeof entitlementKeySchema>;
