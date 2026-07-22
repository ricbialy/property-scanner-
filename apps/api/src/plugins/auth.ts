import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "@propertyscan/auth";
import { findMembership } from "@propertyscan/database";
import type { Role } from "@propertyscan/contracts";

import { roleAtLeast, type AppDeps, type TenantContext } from "../context.js";
import { sendProblem } from "../problems.js";

const PUBLIC_PREFIXES = ["/health/", "/v1/scan-handoff/"];

/**
 * Authentication: every non-public route requires a verified bearer identity.
 * Tenancy: the X-Organization-Id header only *selects* among organizations the
 * authenticated user is a member of — membership is resolved server-side and
 * the header is never trusted as authorization by itself.
 */
export function registerAuth(app: FastifyInstance, deps: AppDeps): void {
  app.addHook("onRequest", async (request, reply) => {
    if (PUBLIC_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
      return;
    }
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      await sendProblem(reply, 401, "Authentication required");
      return reply;
    }
    try {
      const identity = await deps.verifier.verify(header.slice("Bearer ".length));
      request.identity = { userId: identity.userId };
    } catch (error) {
      if (error instanceof AuthError) {
        await sendProblem(reply, 401, "Invalid credentials");
        return reply;
      }
      throw error;
    }
    return undefined;
  });
}

/** Resolve and require a tenant context; optionally require a minimum role. */
export async function requireTenant(
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  minimumRole: Role = "member"
): Promise<TenantContext | null> {
  if (!request.identity) {
    await sendProblem(reply, 401, "Authentication required");
    return null;
  }
  const organizationId = request.headers["x-organization-id"];
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    await sendProblem(reply, 400, "Missing X-Organization-Id header");
    return null;
  }
  const membership = await findMembership(deps.pool, {
    userId: request.identity.userId,
    organizationId
  });
  if (!membership) {
    // 404 rather than 403: do not confirm the organization exists.
    await sendProblem(reply, 404, "Organization not found");
    return null;
  }
  if (!roleAtLeast(membership.role, minimumRole)) {
    await sendProblem(reply, 403, "Insufficient role");
    return null;
  }
  const tenant: TenantContext = {
    organizationId,
    role: membership.role,
    userId: request.identity.userId
  };
  request.tenant = tenant;
  return tenant;
}
