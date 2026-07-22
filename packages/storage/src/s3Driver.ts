import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { assertValidObjectKey, type ObjectStorage } from "./types.js";

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style is required by MinIO. */
  forcePathStyle?: boolean;
}

export function createS3Storage(options: S3StorageOptions): ObjectStorage {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    },
    forcePathStyle: options.forcePathStyle ?? true
  });
  const bucket = options.bucket;

  return {
    async put(key, data, contentType) {
      assertValidObjectKey(key);
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType })
      );
    },
    async get(key) {
      assertValidObjectKey(key);
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) {
        throw new Error(`Object ${key} has no body`);
      }
      return result.Body.transformToByteArray();
    },
    async exists(key) {
      assertValidObjectKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async createUploadUrl(key, contentType, expiresSeconds) {
      assertValidObjectKey(key);
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: expiresSeconds }
      );
    }
  };
}
