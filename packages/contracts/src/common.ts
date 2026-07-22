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
