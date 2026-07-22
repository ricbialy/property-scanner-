import { pino, type Logger } from "pino";

export type { Logger };

/**
 * Structured logger. Correlation IDs (requestId, organizationId, scanSessionId,
 * importRunId, jobId) belong in bindings; raw geometry and signed URLs must never
 * be logged — redaction below is defense in depth, not permission to pass them.
 */
export function createLogger(name: string, level?: string): Logger {
  return pino({
    name,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "*.authorization",
        "*.token",
        "*.signedUrl",
        "req.headers.authorization",
        "req.headers.cookie"
      ],
      censor: "[redacted]"
    }
  });
}
