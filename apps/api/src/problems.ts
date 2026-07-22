import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";

/** RFC 9457 Problem Details responses. */
export function sendProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>
): FastifyReply {
  return reply
    .status(status)
    .header("content-type", "application/problem+json")
    .send({ type: "about:blank", title, status, ...(detail ? { detail } : {}), ...extra });
}

export function sendValidationProblem(reply: FastifyReply, error: ZodError): FastifyReply {
  return sendProblem(reply, 400, "Validation failed", undefined, {
    errors: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  });
}
