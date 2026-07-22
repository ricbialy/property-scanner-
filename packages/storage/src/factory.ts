import { createFsStorage } from "./fsDriver.js";
import { createS3Storage } from "./s3Driver.js";
import type { ObjectStorage } from "./types.js";

export interface StorageConfig {
  driver: "fs" | "s3";
  fsRoot?: string;
  s3?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export function createStorage(config: StorageConfig): ObjectStorage {
  if (config.driver === "s3") {
    if (!config.s3) {
      throw new Error("s3 settings are required for the s3 storage driver");
    }
    return createS3Storage(config.s3);
  }
  return createFsStorage(config.fsRoot ?? ".local/objects");
}
