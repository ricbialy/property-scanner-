import type { FastifyReply, FastifyRequest } from "fastify";
import {
  completeIdempotencyRecord,
  hashRequestBody,
  releaseIdempotencyKey,
  reserveIdempotencyKey
} from "@propertyscan/database";

import type { AppDeps } from "../context.js";
import { sendProblem } from "../problems.js";

/**
 * Idempotency-Key handling for retryable creation endpoints. The key is
 * reserved atomically before the handler runs, so two concurrent requests with
 * the same key cannot both create a resource: the loser sees the reservation
 * and gets the stored response (or a 409 while the winner is still in flight).
 * A replay with the same key and body returns the stored response; the same
 * key with a different body is a 422 conflict per common Idempotency-Key
 * semantics.
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
  const reservation = await reserveIdempotencyKey(deps.pool, {
    organizationId,
    endpoint,
    key,
    requestHash
  });
  if (!reservation.reserved) {
    const existing = reservation.existing;
    if (existing && existing.request_hash !== requestHash) {
      await sendProblem(reply, 422, "Idempotency-Key reused with a different request body");
      return;
    }
    if (!existing || existing.response_status === null) {
      await sendProblem(
        reply,
        409,
        "A request with this Idempotency-Key is still in flight; retry shortly"
      );
      return;
    }
    await reply.status(existing.response_status).send(existing.response_body);
    return;
  }
  let result: { status: number; body: unknown };
  try {
    result = await handler();
  } catch (error) {
    // Free the reservation so the client's retry can actually execute.
    await releaseIdempotencyKey(deps.pool, { organizationId, endpoint, key }).catch(() => {});
    throw error;
  }
  await completeIdempotencyRecord(deps.pool, {
    organizationId,
    endpoint,
    key,
    responseStatus: result.status,
    responseBody: result.body
  });
  await reply.status(result.status).send(result.body);
}
