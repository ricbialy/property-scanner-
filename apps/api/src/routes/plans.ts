import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  acceptRevision,
  appendOutboxEvent,
  findFloorById,
  findPlanById,
  findPlanRevision,
  insertChildRevision,
  insertOpeningRecord,
  insertRoomRecord,
  insertWallRecord,
  recordAuditEvent,
  recordMeasurement,
  transitionScanSession,
  uuidv7,
  withTransaction
} from "@propertyscan/database";
import { formatFeetInches } from "@propertyscan/geometry";
import { createRevisionRequestSchema, type PlanRevisionPayload } from "@propertyscan/contracts";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { sendProblem, sendValidationProblem } from "../problems.js";
import { applyCommands, CommandError } from "../lib/applyCommands.js";

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

export function registerRevisionRoutes(app: FastifyInstance, deps: AppDeps): void {
  /**
   * Create a correction revision from typed commands with optimistic
   * concurrency: parentRevisionId must be the plan's current revision, else
   * 409 with the current id so the client can reload and re-apply.
   */
  app.post("/v1/plans/:planId/revisions", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { planId } = request.params as { planId: string };
    const parsed = createRevisionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const plan = await findPlanById(deps.pool, tenant.organizationId, planId);
    if (!plan || !plan.current_revision_id) {
      return sendProblem(reply, 404, "Plan not found");
    }
    if (plan.current_revision_id !== parsed.data.parentRevisionId) {
      return sendProblem(reply, 409, "Revision conflict", "The plan has a newer revision", {
        currentRevisionId: plan.current_revision_id
      });
    }
    const parent = await findPlanRevision(
      deps.pool,
      tenant.organizationId,
      planId,
      plan.current_revision_id
    );
    if (!parent) {
      return sendProblem(reply, 404, "Plan revision not found");
    }
    if (parent.status === "accepted") {
      // Corrections on an accepted plan start a new draft lineage from it —
      // allowed; the accepted revision itself is never modified.
    }

    let applied: ReturnType<typeof applyCommands>;
    try {
      applied = applyCommands(parent.payload, parsed.data.commands, {
        planId,
        revisionId: "00000000-0000-7000-8000-000000000000" // replaced below
      });
    } catch (error) {
      if (error instanceof CommandError) {
        return sendProblem(reply, 422, "Command failed", error.message, {
          commandIndex: error.commandIndex
        });
      }
      throw error;
    }

    const revision = await withTransaction(deps.pool, async (tx) => {
      const guard = await tx.query(
        "select current_revision_id from plans where id = $1 and organization_id = $2 for update",
        [planId, tenant.organizationId]
      );
      if (guard.rows[0]?.current_revision_id !== parsed.data.parentRevisionId) {
        return null;
      }
      const created = await insertChildRevision(tx, tenant.organizationId, {
        planId,
        parentRevision: parent,
        reason: parsed.data.reason,
        authorType: "user",
        buildPayload: (revisionId) => ({ ...applied.payload, revisionId })
      });
      // Relational projection rows are revision-local: payload ids stay stable
      // across revisions (they are the reference identity), so the projection
      // mints fresh row ids and remaps internal room/wall references.
      const roomRowId = new Map<string, string>();
      for (const room of created.payload.rooms) {
        const rowId = uuidv7();
        roomRowId.set(room.id, rowId);
        await insertRoomRecord(tx, tenant.organizationId, {
          id: rowId,
          planRevisionId: created.id,
          sourceRoomId: room.sourceRoomId,
          name: room.name,
          confidence: room.confidence,
          boundary: room.boundary === "not_processed" ? null : room.boundary,
          areaM2: room.areaM2 === "not_processed" ? null : room.areaM2
        });
      }
      const wallRowId = new Map<string, string>();
      for (const wall of created.payload.walls) {
        const rowId = uuidv7();
        wallRowId.set(wall.id, rowId);
        await insertWallRecord(tx, tenant.organizationId, {
          planRevisionId: created.id,
          wall: { ...wall, id: rowId, roomId: roomRowId.get(wall.roomId) ?? wall.roomId }
        });
      }
      for (const opening of created.payload.openings) {
        await insertOpeningRecord(tx, tenant.organizationId, {
          planRevisionId: created.id,
          opening: {
            ...opening,
            id: uuidv7(),
            wallId: opening.wallId ? (wallRowId.get(opening.wallId) ?? null) : null,
            sourceId: opening.sourceId ?? opening.id
          }
        });
      }
      for (const verification of applied.verifications) {
        for (const value of verification.values) {
          await recordMeasurement(tx, tenant.organizationId, {
            subjectType: "opening",
            subjectId: verification.openingId,
            value: value.valueM,
            unit: "m",
            semanticType: value.semanticType,
            source: verification.source,
            capturedBy: tenant.userId,
            capturedAt: new Date(),
            verification: "field_verified",
            planRevisionId: created.id
          });
        }
      }
      await recordAuditEvent(tx, {
        organizationId: tenant.organizationId,
        actorType: "user",
        actorId: tenant.userId,
        action: "plan_revision.created",
        subjectType: "plan_revision",
        subjectId: created.id,
        metadata: { planId, commandCount: parsed.data.commands.length }
      });
      return created;
    });
    if (!revision) {
      const fresh = await findPlanById(deps.pool, tenant.organizationId, planId);
      return sendProblem(reply, 409, "Revision conflict", "The plan has a newer revision", {
        currentRevisionId: fresh?.current_revision_id ?? null
      });
    }
    return reply.status(201).send({
      id: revision.id,
      planId: revision.plan_id,
      parentRevisionId: revision.parent_revision_id,
      status: revision.status,
      version: revision.version,
      payload: revision.payload,
      createdAt: revision.created_at.toISOString()
    });
  });

  app.post("/v1/plans/:planId/revisions/:revisionId/accept", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { planId, revisionId } = request.params as { planId: string; revisionId: string };
    const result = await withTransaction(deps.pool, async (tx) => {
      const accepted = await acceptRevision(tx, tenant.organizationId, planId, revisionId);
      if (!accepted) {
        return null;
      }
      const plan = await findPlanById(tx, tenant.organizationId, planId);
      if (plan?.scan_session_id) {
        // Session completes when a revision is accepted; a stale state is fine.
        await transitionScanSession(
          tx,
          tenant.organizationId,
          plan.scan_session_id,
          "needs_review",
          "completed"
        ).catch(() => null);
      }
      await appendOutboxEvent(tx, {
        organizationId: tenant.organizationId,
        eventType: "plan.accepted",
        resourceType: "plan",
        resourceId: planId,
        payload: { planId, revisionId }
      });
      await recordAuditEvent(tx, {
        organizationId: tenant.organizationId,
        actorType: "user",
        actorId: tenant.userId,
        action: "plan_revision.accepted",
        subjectType: "plan_revision",
        subjectId: revisionId,
        metadata: { planId }
      });
      return accepted;
    });
    if (!result) {
      return sendProblem(
        reply,
        409,
        "Cannot accept",
        "Only the plan's current revision can be accepted"
      );
    }
    return {
      id: result.id,
      planId: result.plan_id,
      status: result.status,
      version: result.version
    };
  });
}
