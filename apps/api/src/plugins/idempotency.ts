import type { FastifyReply, FastifyRequest } from "fastify";
import {
  findIdempotencyRecord,
  hashRequestBody,
  storeIdempotencyRecord
} from "@propertyscan/database";

import type { AppDeps } from "../context.js";
import { sendProblem } from "../problems.js";

/**
 * Idempotency-Key handling for retryable creation endpoints. A replay with the
 * same key and body returns the stored response; the same key with a different
 * body is a 422 conflict per common Idempotency-Key semantics.
 */
export async function withIdempotency(
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  endpoint: string,
  organizationId: string,
  handler: () => Promise<{ status: number; body: unknown }>
): Promise<void> {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0 || key.length > 200) {
    await sendProblem(reply, 400, "Idempotency-Key header is required");
    return;
  }
  const requestHash = hashRequestBody(request.body);
  const existing = await findIdempotencyRecord(deps.pool, organizationId, endpoint, key);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      await sendProblem(reply, 422, "Idempotency-Key reused with a different request body");
      return;
    }
    await reply.status(existing.response_status ?? 200).send(existing.response_body);
    return;
  }
  const result = await handler();
  await storeIdempotencyRecord(deps.pool, {
    organizationId,
    endpoint,
    key,
    requestHash,
    responseStatus: result.status,
    responseBody: result.body
  });
  await reply.status(result.status).send(result.body);
}
