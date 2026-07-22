import type { FastifyInstance } from "fastify";
import { createOrganizationRequestSchema } from "@propertyscan/contracts";
import {
  createOrganizationWithOwner,
  listOrganizationsForUser,
  recordAuditEvent,
  withTransaction
} from "@propertyscan/database";

import type { AppDeps } from "../context.js";
import { sendProblem, sendValidationProblem } from "../problems.js";

export function registerOrganizationRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Bootstrap: any authenticated user may create an organization they will own.
  app.post("/v1/organizations", async (request, reply) => {
    if (!request.identity) {
      return sendProblem(reply, 401, "Authentication required");
    }
    const parsed = createOrganizationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const userId = request.identity.userId;
    const org = await withTransaction(deps.pool, async (tx) => {
      const created = await createOrganizationWithOwner(tx, {
        name: parsed.data.name,
        ownerUserId: userId
      });
      await recordAuditEvent(tx, {
        organizationId: created.id,
        actorType: "user",
        actorId: userId,
        action: "organization.created",
        subjectType: "organization",
        subjectId: created.id
      });
      return created;
    });
    return reply.status(201).send({
      id: org.id,
      name: org.name,
      createdAt: org.created_at.toISOString()
    });
  });

  app.get("/v1/organizations", async (request, reply) => {
    if (!request.identity) {
      return sendProblem(reply, 401, "Authentication required");
    }
    const orgs = await listOrganizationsForUser(deps.pool, request.identity.userId);
    return {
      data: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        role: o.role,
        createdAt: o.created_at.toISOString()
      }))
    };
  });
}
