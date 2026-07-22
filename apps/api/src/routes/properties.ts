import type { FastifyInstance } from "fastify";
import { createFloorRequestSchema, createPropertyRequestSchema } from "@propertyscan/contracts";
import {
  createFloor,
  createProperty,
  findPropertyById,
  listProperties,
  recordAuditEvent,
  type FloorRow,
  type PropertyRow
} from "@propertyscan/database";
import { z } from "zod";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { sendProblem, sendValidationProblem } from "../problems.js";

function serializeProperty(row: PropertyRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    externalReferences: row.external_references,
    createdAt: row.created_at.toISOString()
  };
}

function serializeFloor(row: FloorRow) {
  return {
    id: row.id,
    propertyId: row.property_id,
    name: row.name,
    ordinal: row.ordinal,
    displayUnits: row.display_units,
    createdAt: row.created_at.toISOString()
  };
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional()
});

export function registerPropertyRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/v1/properties", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const parsed = createPropertyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const property = await createProperty(deps.pool, tenant.organizationId, parsed.data);
    await recordAuditEvent(deps.pool, {
      organizationId: tenant.organizationId,
      actorType: "user",
      actorId: tenant.userId,
      action: "property.created",
      subjectType: "property",
      subjectId: property.id
    });
    return reply.status(201).send(serializeProperty(property));
  });

  app.get("/v1/properties", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationProblem(reply, query.error);
    }
    const rows = await listProperties(deps.pool, tenant.organizationId, {
      limit: query.data.limit + 1,
      ...(query.data.cursor ? { cursor: query.data.cursor } : {})
    });
    const page = rows.slice(0, query.data.limit);
    const nextCursor = rows.length > query.data.limit ? page[page.length - 1]?.id : undefined;
    return { data: page.map(serializeProperty), ...(nextCursor ? { nextCursor } : {}) };
  });

  app.get("/v1/properties/:propertyId", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "viewer");
    if (!tenant) return;
    const { propertyId } = request.params as { propertyId: string };
    const property = await findPropertyById(deps.pool, tenant.organizationId, propertyId);
    if (!property) {
      return sendProblem(reply, 404, "Property not found");
    }
    return serializeProperty(property);
  });

  app.post("/v1/properties/:propertyId/floors", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "member");
    if (!tenant) return;
    const { propertyId } = request.params as { propertyId: string };
    const property = await findPropertyById(deps.pool, tenant.organizationId, propertyId);
    if (!property) {
      return sendProblem(reply, 404, "Property not found");
    }
    const parsed = createFloorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const floor = await createFloor(deps.pool, tenant.organizationId, {
      propertyId,
      name: parsed.data.name,
      ordinal: parsed.data.ordinal,
      displayUnits: parsed.data.displayUnits
    });
    return reply.status(201).send(serializeFloor(floor));
  });
}
