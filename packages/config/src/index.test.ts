import { describe, expect, it } from "vitest";

import { loadEnv } from "./index.js";

const base = {
  DATABASE_URL: "postgres://propertyscan:propertyscan@localhost:5432/propertyscan",
  WEBHOOK_MASTER_ENCRYPTION_KEY: "dev-only-not-a-real-key-0000000000000000"
};

describe("loadEnv", () => {
  it("applies safe development defaults", () => {
    const env = loadEnv({ ...base });
    expect(env.APP_ENV).toBe("development");
    expect(env.AUTH_MODE).toBe("dev");
    expect(env.STORAGE_DRIVER).toBe("fs");
    expect(env.DISABLE_EXTERNAL_WEBHOOKS).toBe(true);
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      loadEnv({ WEBHOOK_MASTER_ENCRYPTION_KEY: base.WEBHOOK_MASTER_ENCRYPTION_KEY })
    ).toThrow(/DATABASE_URL/);
  });

  it("requires clerk issuer when AUTH_MODE=clerk", () => {
    expect(() => loadEnv({ ...base, AUTH_MODE: "clerk" })).toThrow(/CLERK_JWT_ISSUER/);
  });

  it("requires S3 settings when STORAGE_DRIVER=s3", () => {
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
  });

  it("fails closed in production with dev placeholders", () => {
    expect(() =>
      loadEnv({
        ...base,
        APP_ENV: "production",
        AUTH_MODE: "dev"
      })
    ).toThrow(/AUTH_MODE must be 'clerk' in production/);
  });
});
