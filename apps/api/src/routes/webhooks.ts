import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createWebhookEndpoint,
  listActiveWebhookEndpoints,
  recordAuditEvent
} from "@propertyscan/database";

import type { AppDeps } from "../context.js";
import { requireTenant } from "../plugins/auth.js";
import { sendProblem, sendValidationProblem } from "../problems.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);

export function registerWebhookRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/v1/webhook-endpoints", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "admin");
    if (!tenant) return;
    const parsed = z
      .object({
        url: z.string().url().max(500),
        secret: z.string().min(16).max(200)
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return sendValidationProblem(reply, parsed.error);
    }
    const url = new URL(parsed.data.url);
    if (deps.env.DISABLE_EXTERNAL_WEBHOOKS && !LOCAL_HOSTS.has(url.hostname)) {
      return sendProblem(
        reply,
        422,
        "External webhooks disabled",
        "DISABLE_EXTERNAL_WEBHOOKS=true only permits localhost endpoints in this environment"
      );
    }
    const endpoint = await createWebhookEndpoint(deps.pool, tenant.organizationId, {
      url: parsed.data.url,
      secret: parsed.data.secret,
      masterKey: deps.env.WEBHOOK_MASTER_ENCRYPTION_KEY
    });
    await recordAuditEvent(deps.pool, {
      organizationId: tenant.organizationId,
      actorType: "user",
      actorId: tenant.userId,
      action: "webhook_endpoint.created",
      subjectType: "webhook_endpoint",
      subjectId: endpoint.id,
      metadata: { url: parsed.data.url }
    });
    return reply.status(201).send({
      id: endpoint.id,
      url: endpoint.url,
      keyId: endpoint.secret_key_id,
      active: endpoint.active,
      createdAt: endpoint.created_at.toISOString()
    });
  });

  app.get("/v1/webhook-endpoints", async (request, reply) => {
    const tenant = await requireTenant(deps, request, reply, "admin");
    if (!tenant) return;
    const endpoints = await listActiveWebhookEndpoints(deps.pool, tenant.organizationId);
    return {
      data: endpoints.map((e) => ({
        id: e.id,
        url: e.url,
        keyId: e.secret_key_id,
        active: e.active,
        createdAt: e.created_at.toISOString()
      }))
    };
  });
}
