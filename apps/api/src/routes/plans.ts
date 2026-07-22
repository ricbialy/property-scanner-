import type { FastifyInstance } from "fastify";
import { findPlanById, findPlanRevision } from "@propertyscan/database";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { sendProblem } from "../problems.js";

export function registerPlanRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/plans/:planId", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { planId } = request.params as { planId: string };
    const plan = await findPlanById(deps.pool, tenant.organizationId, planId);
    if (!plan) {
      return sendProblem(reply, 404, "Plan not found");
    }
    let currentRevision = null;
    if (plan.current_revision_id) {
      currentRevision = await findPlanRevision(
        deps.pool,
        tenant.organizationId,
        planId,
        plan.current_revision_id
      );
    }
    return {
      id: plan.id,
      organizationId: plan.organization_id,
      floorId: plan.floor_id,
      scanSessionId: plan.scan_session_id,
      currentRevisionId: plan.current_revision_id,
      createdAt: plan.created_at.toISOString(),
      currentRevision: currentRevision
        ? {
            id: currentRevision.id,
            status: currentRevision.status,
            version: currentRevision.version,
            authorType: currentRevision.author_type,
            reason: currentRevision.reason,
            geometrySchemaVersion: currentRevision.geometry_schema_version,
            payload: currentRevision.payload,
            createdAt: currentRevision.created_at.toISOString()
          }
        : null
    };
  });

  app.get("/v1/plans/:planId/revisions/:revisionId", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { planId, revisionId } = request.params as { planId: string; revisionId: string };
    const revision = await findPlanRevision(deps.pool, tenant.organizationId, planId, revisionId);
    if (!revision) {
      return sendProblem(reply, 404, "Plan revision not found");
    }
    return {
      id: revision.id,
      planId: revision.plan_id,
      parentRevisionId: revision.parent_revision_id,
      authorType: revision.author_type,
      reason: revision.reason,
      status: revision.status,
      version: revision.version,
      geometrySchemaVersion: revision.geometry_schema_version,
      payload: revision.payload,
      createdAt: revision.created_at.toISOString()
    };
  });
}
