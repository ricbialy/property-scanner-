import { z } from "zod";

const booleanFromString = z
  .string()
  .transform((value) => value === "true" || value === "1")
  .pipe(z.boolean());

/**
 * Environment schema shared by API and worker. Validation fails fast at startup;
 * production refuses to boot on placeholder or missing mandatory secrets.
 */
export const envSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    API_BASE_URL: z.string().url().default("http://localhost:4000"),
    WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),

    AUTH_MODE: z.enum(["dev", "clerk"]).default("dev"),
    CLERK_PUBLISHABLE_KEY: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_JWT_ISSUER: z.string().url().optional(),

    STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
    STORAGE_FS_ROOT: z.string().default(".local/objects"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(524_288_000),

    WEBHOOK_MASTER_ENCRYPTION_KEY: z.string().min(16),
    DISABLE_EXTERNAL_WEBHOOKS: booleanFromString.default("true"),

    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional()
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === "production") {
      if (env.AUTH_MODE !== "clerk") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "AUTH_MODE must be 'clerk' in production"
        });
      }
      if (!env.CLERK_JWT_ISSUER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CLERK_JWT_ISSUER is required in production"
        });
      }
      if (env.STORAGE_DRIVER !== "s3") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "STORAGE_DRIVER must be 's3' in production"
        });
      }
      if (env.WEBHOOK_MASTER_ENCRYPTION_KEY.startsWith("dev-only")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WEBHOOK_MASTER_ENCRYPTION_KEY must not be a development placeholder"
        });
      }
    }
    if (env.AUTH_MODE === "clerk" && !env.CLERK_JWT_ISSUER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CLERK_JWT_ISSUER is required when AUTH_MODE=clerk"
      });
    }
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of [
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY"
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when STORAGE_DRIVER=s3`
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
