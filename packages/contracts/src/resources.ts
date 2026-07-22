import { z } from "zod";

import { isoTimestampSchema, scanSessionStatusSchema, uuidSchema } from "./common.js";

export const roleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const createOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200)
});

export const organizationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  createdAt: isoTimestampSchema
});

export const createPropertyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  country: z.string().max(2).optional(),
  externalReferences: z
    .array(
      z.object({
        system: z.string().min(1).max(60),
        type: z.string().min(1).max(60),
        value: z.string().min(1).max(200)
      })
    )
    .max(20)
    .optional()
});
export type CreatePropertyRequest = z.infer<typeof createPropertyRequestSchema>;

export const propertySchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  externalReferences: z.array(
    z.object({ system: z.string(), type: z.string(), value: z.string() })
  ),
  createdAt: isoTimestampSchema
});
export type Property = z.infer<typeof propertySchema>;

export const createFloorRequestSchema = z.object({
  name: z.string().min(1).max(120),
  ordinal: z.number().int().min(-10).max(200).default(0),
  displayUnits: z.enum(["metric", "imperial"]).default("imperial")
});

export const floorSchema = z.object({
  id: uuidSchema,
  propertyId: uuidSchema,
  name: z.string(),
  ordinal: z.number().int(),
  displayUnits: z.enum(["metric", "imperial"]),
  createdAt: isoTimestampSchema
});
export type Floor = z.infer<typeof floorSchema>;

export const createScanSessionRequestSchema = z.object({
  propertyId: uuidSchema,
  floorId: uuidSchema,
  requestedOutputs: z
    .array(z.enum(["normalized_json", "svg", "pdf"]))
    .min(1)
    .default(["normalized_json"]),
  externalReferences: z
    .array(
      z.object({
        system: z.string().min(1).max(60),
        type: z.string().min(1).max(60),
        value: z.string().min(1).max(200)
      })
    )
    .max(20)
    .optional()
});
export type CreateScanSessionRequest = z.infer<typeof createScanSessionRequestSchema>;

export const scanSessionSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  propertyId: uuidSchema,
  floorId: uuidSchema,
  status: scanSessionStatusSchema,
  requestedOutputs: z.array(z.enum(["normalized_json", "svg", "pdf"])),
  externalReferences: z.array(
    z.object({ system: z.string(), type: z.string(), value: z.string() })
  ),
  planId: uuidSchema.nullable(),
  failureReason: z.string().nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
});
export type ScanSession = z.infer<typeof scanSessionSchema>;

export const handoffTokenResponseSchema = z.object({
  scanSessionId: uuidSchema,
  /** Opaque short-lived token; returned exactly once, only the hash is stored. */
  token: z.string(),
  deepLinkUrl: z.string().url(),
  browserFallbackUrl: z.string().url(),
  expiresAt: isoTimestampSchema
});
export type HandoffTokenResponse = z.infer<typeof handoffTokenResponseSchema>;

export const createUploadRequestSchema = z.object({
  captureId: uuidSchema,
  byteSize: z.number().int().positive(),
  contentType: z.literal("application/zip")
});

export const uploadResponseSchema = z.object({
  uploadId: uuidSchema,
  /** Where the client PUTs the bundle. Local driver returns an API-relative path. */
  uploadUrl: z.string(),
  objectKey: z.string(),
  expiresAt: isoTimestampSchema
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const completeUploadRequestSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().positive()
});
