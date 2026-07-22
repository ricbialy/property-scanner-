import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { assertValidObjectKey, type ObjectStorage } from "./types.js";

/**
 * Filesystem-backed object storage for local development and tests only.
 * packages/config refuses this driver in production.
 */
export function createFsStorage(rootDir: string): ObjectStorage {
  const root = resolve(rootDir);

  function pathFor(key: string): string {
    assertValidObjectKey(key);
    const full = resolve(join(root, key));
    if (!full.startsWith(root + sep)) {
      throw new Error(`Object key escapes storage root: ${key}`);
    }
    return full;
  }

  return {
    async put(key, data, _contentType) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async get(key) {
      return new Uint8Array(await readFile(pathFor(key)));
    },
    async exists(key) {
      try {
        await access(pathFor(key));
        return true;
      } catch {
        return false;
      }
    },
    async createUploadUrl(_key, _contentType, _expiresSeconds) {
      return null;
    }
  };
}
