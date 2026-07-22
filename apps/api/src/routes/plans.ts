import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { findFloorById, findPlanById, findPlanRevision } from "@propertyscan/database";
import { formatFeetInches } from "@propertyscan/geometry";
import type { PlanRevisionPayload } from "@propertyscan/contracts";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { sendProblem } from "../problems.js";

interface RevisionContext {
  organizationId: string;
  planId: string;
  floorId: string;
  revisionId: string;
  payload: PlanRevisionPayload;
}

async function loadCurrentRevision(
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<RevisionContext | null> {
  const tenant = await requireTenant(deps, request, reply, "viewer");
  if (!tenant) return null;
  const { planId } = request.params as { planId: string };
  const plan = await findPlanById(deps.pool, tenant.organizationId, planId);
  if (!plan || !plan.current_revision_id) {
    await sendProblem(reply, 404, "Plan not found");
    return null;
  }
  const revision = await findPlanRevision(
    deps.pool,
    tenant.organizationId,
    planId,
    plan.current_revision_id
  );
  if (!revision) {
    await sendProblem(reply, 404, "Plan revision not found");
    return null;
  }
  return {
    organizationId: tenant.organizationId,
    planId,
    floorId: plan.floor_id,
    revisionId: revision.id,
    payload: revision.payload
  };
}

/** Imperial display text for a metric value; presentation only, never stored. */
function display(valueM: number | string | null, imperial: boolean): string | null {
  if (typeof valueM !== "number") return null;
  return imperial ? formatFeetInches(valueM).text : `${valueM.toFixed(3)} m`;
}

function scheduleEntries(
  ctx: RevisionContext,
  type: "window" | "door",
  imperial: boolean
): unknown[] {
  const roomNameById = new Map(ctx.payload.rooms.map((r) => [r.id, r.name ?? "Unnamed room"]));
  return ctx.payload.openings
    .filter((o) => o.type === type)
    .map((o, index) => ({
      key: `${type === "window" ? "W" : "D"}${String(index + 1).padStart(2, "0")}`,
      openingId: o.id,
      type: o.type,
      rooms: o.roomIds.map((id) => roomNameById.get(id) ?? "Unknown room"),
      widthM: o.widthM,
      heightM: o.heightM,
      sillHeightM: o.sillHeightM,
      widthDisplay: display(o.widthM, imperial),
      heightDisplay: display(o.heightM, imperial),
      sillHeightDisplay: display(o.sillHeightM, imperial),
      confidence: o.confidence,
      verification: o.verification
    }));
}

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

  app.get("/v1/plans/:planId/openings", async (request, reply) => {
    const ctx = await loadCurrentRevision(deps, request, reply);
    if (!ctx) return;
    return { revisionId: ctx.revisionId, data: ctx.payload.openings };
  });

  for (const [path, type] of [
    ["windows", "window"],
    ["doors", "door"]
  ] as const) {
    app.get(`/v1/plans/:planId/schedules/${path}`, async (request, reply) => {
      const ctx = await loadCurrentRevision(deps, request, reply);
      if (!ctx) return;
      const floor = await findFloorById(deps.pool, ctx.organizationId, ctx.floorId);
      const imperial = floor?.display_units !== "metric";
      return {
        revisionId: ctx.revisionId,
        displayUnits: imperial ? "imperial" : "metric",
        disclaimer:
          "Measurements are preliminary estimates unless marked field_verified. Not for installation without field verification.",
        data: scheduleEntries(ctx, type, imperial)
      };
    });
  }
}
