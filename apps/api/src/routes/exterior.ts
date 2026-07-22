import type { FastifyInstance } from "fastify";
import {
  createFacadeOpeningRequestSchema,
  createFacadeRequestSchema,
  createMeasurementRequestSchema
} from "@propertyscan/contracts";
import {
  applyFacadeOpeningMeasurement,
  createFacade,
  createFacadeOpening,
  findFacadeById,
  findFacadeOpeningById,
  findPropertyById,
  listFacadeOpenings,
  listFacades,
  recordAuditEvent,
  recordMeasurement,
  withTransaction,
  type FacadeOpeningRow,
  type FacadeRow
} from "@propertyscan/database";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { sendProblem, sendValidationProblem } from "../problems.js";

function serializeFacade(row: FacadeRow) {
  return {
    id: row.id,
    propertyId: row.property_id,
    label: row.label,
    orientationDeg: row.orientation_deg,
    notes: row.notes,
    createdAt: row.created_at.toISOString()
  };
}

function serializeFacadeOpening(row: FacadeOpeningRow) {
  return {
    id: row.id,
    facadeId: row.facade_id,
    openingType: row.opening_type,
    label: row.label,
    widthM: row.width_m,
    heightM: row.height_m,
    sillHeightM: row.sill_height_m,
    linkedInteriorOpeningId: row.linked_interior_opening_id,
    confidence: row.confidence,
    verification: row.verification,
    createdAt: row.created_at.toISOString()
  };
}

export function registerExteriorRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/v1/properties/:propertyId/facades", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { propertyId } = request.params as { propertyId: string };
    const property = await findPropertyById(deps.pool, tenant.organizationId, propertyId);
    if (!property) {
      return sendProblem(reply, 404, "Property not found");
    }
    const parsed = createFacadeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const facade = await createFacade(deps.pool, tenant.organizationId, {
      propertyId,
      label: parsed.data.label,
      ...(parsed.data.orientationDeg !== undefined
        ? { orientationDeg: parsed.data.orientationDeg }
        : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {})
    });
    return reply.status(201).send(serializeFacade(facade));
  });

  app.get("/v1/properties/:propertyId/facades", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { propertyId } = request.params as { propertyId: string };
    const property = await findPropertyById(deps.pool, tenant.organizationId, propertyId);
    if (!property) {
      return sendProblem(reply, 404, "Property not found");
    }
    const facades = await listFacades(deps.pool, tenant.organizationId, propertyId);
    return { data: facades.map(serializeFacade) };
  });

  app.post("/v1/facades/:facadeId/openings", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { facadeId } = request.params as { facadeId: string };
    const facade = await findFacadeById(deps.pool, tenant.organizationId, facadeId);
    if (!facade) {
      return sendProblem(reply, 404, "Facade not found");
    }
    const parsed = createFacadeOpeningRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const opening = await createFacadeOpening(deps.pool, tenant.organizationId, {
      facadeId,
      openingType: parsed.data.openingType,
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.widthM !== undefined ? { widthM: parsed.data.widthM } : {}),
      ...(parsed.data.heightM !== undefined ? { heightM: parsed.data.heightM } : {}),
      ...(parsed.data.sillHeightM !== undefined ? { sillHeightM: parsed.data.sillHeightM } : {}),
      ...(parsed.data.linkedInteriorOpeningId !== undefined
        ? { linkedInteriorOpeningId: parsed.data.linkedInteriorOpeningId }
        : {})
    });
    return reply.status(201).send(serializeFacadeOpening(opening));
  });

  app.get("/v1/facades/:facadeId/openings", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { facadeId } = request.params as { facadeId: string };
    const facade = await findFacadeById(deps.pool, tenant.organizationId, facadeId);
    if (!facade) {
      return sendProblem(reply, 404, "Facade not found");
    }
    const openings = await listFacadeOpenings(deps.pool, tenant.organizationId, facadeId);
    return { data: openings.map(serializeFacadeOpening) };
  });

  /**
   * Record a measurement with provenance (spec §7.4). For facade openings the
   * latest reviewed/field-verified width/height/sill also updates the displayed
   * dimension — as a new superseding record, never a mutation of history.
   */
  app.post("/v1/measurements", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const parsed = createMeasurementRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const input = parsed.data;

    if (input.subjectType === "facade_opening") {
      const opening = await findFacadeOpeningById(
        deps.pool,
        tenant.organizationId,
        input.subjectId
      );
      if (!opening) {
        return sendProblem(reply, 404, "Facade opening not found");
      }
    } else if (input.subjectType === "facade") {
      const facade = await findFacadeById(deps.pool, tenant.organizationId, input.subjectId);
      if (!facade) {
        return sendProblem(reply, 404, "Facade not found");
      }
    }
    // Interior subjects (wall/opening/room) live inside plan revision payloads;
    // existence is validated when the editor lands (Phase 4). The measurement
    // is still tenant-scoped and provenance-complete.

    const verification = input.fieldVerified ? "field_verified" : "unverified";
    const measurement = await withTransaction(deps.pool, async (tx) => {
      const row = await recordMeasurement(tx, tenant.organizationId, {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        value: input.value,
        unit: input.unit,
        semanticType: input.semanticType,
        source: input.source,
        capturedBy: tenant.userId,
        capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
        ...(input.uncertaintyM !== undefined ? { uncertaintyM: input.uncertaintyM } : {}),
        verification,
        ...(input.notes !== undefined ? { notes: input.notes } : {})
      });
      if (
        input.subjectType === "facade_opening" &&
        verification === "field_verified" &&
        (input.semanticType === "width" ||
          input.semanticType === "height" ||
          input.semanticType === "sill_height")
      ) {
        await applyFacadeOpeningMeasurement(
          tx,
          tenant.organizationId,
          input.subjectId,
          input.semanticType,
          input.value,
          "field_verified"
        );
      }
      await recordAuditEvent(tx, {
        organizationId: tenant.organizationId,
        actorType: "user",
        actorId: tenant.userId,
        action: "measurement.recorded",
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        metadata: { semanticType: input.semanticType, source: input.source, verification }
      });
      return row;
    });

    return reply.status(201).send({
      id: measurement.id,
      subjectType: measurement.subject_type,
      subjectId: measurement.subject_id,
      value: measurement.value,
      unit: measurement.unit,
      semanticType: measurement.semantic_type,
      source: measurement.source,
      verification: measurement.verification,
      capturedBy: measurement.captured_by,
      capturedAt: measurement.captured_at?.toISOString() ?? null,
      uncertaintyM: measurement.uncertainty_m,
      createdAt: measurement.created_at.toISOString()
    });
  });
}
