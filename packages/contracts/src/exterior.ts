import { z } from "zod";

import {
  confidenceLevelSchema,
  isoTimestampSchema,
  measurementVerificationSchema,
  uuidSchema
} from "./common.js";

/**
 * Exterior layer contracts. V1 exterior capture is documentation-first:
 * facades and their openings are recorded with manual or laser-verified
 * measurements and photos. No automatic exterior reconstruction is claimed.
 */
export const facadeOpeningTypeSchema = z.enum(["window", "door", "garage_door", "vent", "other"]);

export const createFacadeRequestSchema = z.object({
  label: z.string().min(1).max(120),
  orientationDeg: z.number().min(0).lt(360).optional(),
  notes: z.string().max(2000).optional()
});
export type CreateFacadeRequest = z.infer<typeof createFacadeRequestSchema>;

export const facadeSchema = z.object({
  id: uuidSchema,
  propertyId: uuidSchema,
  label: z.string(),
  orientationDeg: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: isoTimestampSchema
});
export type Facade = z.infer<typeof facadeSchema>;

export const createFacadeOpeningRequestSchema = z.object({
  openingType: facadeOpeningTypeSchema,
  label: z.string().max(120).optional(),
  /** Dimensions in meters (canonical); imperial is display-only. */
  widthM: z.number().positive().max(30).optional(),
  heightM: z.number().positive().max(30).optional(),
  sillHeightM: z.number().min(0).max(30).optional(),
  linkedInteriorOpeningId: uuidSchema.optional()
});
export type CreateFacadeOpeningRequest = z.infer<typeof createFacadeOpeningRequestSchema>;

export const facadeOpeningSchema = z.object({
  id: uuidSchema,
  facadeId: uuidSchema,
  openingType: facadeOpeningTypeSchema,
  label: z.string().nullable(),
  widthM: z.number().nullable(),
  heightM: z.number().nullable(),
  sillHeightM: z.number().nullable(),
  linkedInteriorOpeningId: uuidSchema.nullable(),
  confidence: confidenceLevelSchema,
  verification: measurementVerificationSchema,
  createdAt: isoTimestampSchema
});
export type FacadeOpening = z.infer<typeof facadeOpeningSchema>;

/** Measurement entry against any subject (interior or exterior). */
export const createMeasurementRequestSchema = z.object({
  subjectType: z.enum(["wall", "opening", "room", "facade", "facade_opening"]),
  subjectId: uuidSchema,
  value: z.number().positive().max(1000),
  unit: z.literal("m"),
  semanticType: z.enum(["width", "height", "sill_height", "length", "thickness", "elevation"]),
  source: z.enum(["manual", "laser"]),
  capturedAt: isoTimestampSchema.optional(),
  uncertaintyM: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).optional(),
  /** Marking field_verified requires an explicit method assertion. */
  fieldVerified: z.boolean().default(false)
});
export type CreateMeasurementRequest = z.infer<typeof createMeasurementRequestSchema>;
