import type { Role } from "@propertyscan/contracts";
import type { ObjectStorage } from "@propertyscan/storage";
import type { TokenVerifier } from "@propertyscan/auth";
import type { Env } from "@propertyscan/config";
import type pg from "pg";

export interface AppDeps {
  env: Env;
  pool: pg.Pool;
  storage: ObjectStorage;
  verifier: TokenVerifier;
}

export interface TenantContext {
  organizationId: string;
  role: Role;
  userId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    identity?: { userId: string };
    tenant?: TenantContext;
  }
}

/** Role hierarchy: every role includes the capabilities of the roles after it. */
const ROLE_ORDER: Role[] = ["owner", "admin", "member", "viewer"];

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_ORDER.indexOf(actual) <= ROLE_ORDER.indexOf(required);
}
