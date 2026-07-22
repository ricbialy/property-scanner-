import { z } from "zod";

import { isoTimestampSchema, sha256HexSchema, uuidSchema } from "./common.js";

export const mediaContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/heic"]);
export type MediaContentType = z.infer<typeof mediaContentTypeSchema>;

export const createMediaUploadRequestSchema = z.object({
  byteSize: z.number().int().positive(),
  contentType: mediaContentTypeSchema,
  /** Client capture timestamp, kept per privacy policy (GPS is stripped). */
  capturedAt: isoTimestampSchema.optional()
});
export type CreateMediaUploadRequest = z.infer<typeof createMediaUploadRequestSchema>;

export const completeMediaUploadRequestSchema = z.object({
  sha256: sha256HexSchema,
  byteSize: z.number().int().positive()
});

export const mediaSchema = z.object({
  id: uuidSchema,
  contentType: z.string(),
  byteSize: z.number().nullable(),
  sha256: z.string().nullable(),
  widthPx: z.number().nullable(),
  heightPx: z.number().nullable(),
  capturedAt: isoTimestampSchema.nullable(),
  exifPolicy: z.string(),
  status: z.enum(["pending", "ready", "rejected"]),
  createdAt: isoTimestampSchema
});
export type Media = z.infer<typeof mediaSchema>;

export const createMediaLinkRequestSchema = z.object({
  mediaId: uuidSchema,
  position: z.number().int().min(0).max(1000).default(0)
});
export type CreateMediaLinkRequest = z.infer<typeof createMediaLinkRequestSchema>;
