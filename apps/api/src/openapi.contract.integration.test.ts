import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createTestApp, type TestApp } from "./testSupport.js";

/**
 * Contract test: docs/api/openapi.yaml and the running router must agree.
 * Every documented path+method must exist in the router (a request to it may
 * fail auth/validation but never 404-route), and every documented operation
 * carries a security declaration consistent with the public-route allowlist.
 */
const specPath = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/api/openapi.yaml");

const PUBLIC_OPERATIONS = new Set([
  "GET /health/live",
  "GET /health/ready",
  "POST /v1/scan-handoff/redeem"
]);

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.teardown();
});

interface OperationObject {
  security?: unknown[];
}

describe("OpenAPI contract", () => {
  const spec = parse(readFileSync(specPath, "utf8")) as {
    openapi: string;
    paths: Record<string, Record<string, OperationObject>>;
  };

  it("is an OpenAPI 3.1 document with paths", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(20);
  });

  const operations: Array<{ method: string; path: string; operation: OperationObject }> = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (["get", "post", "put", "delete", "patch"].includes(method)) {
        operations.push({ method: method.toUpperCase(), path, operation });
      }
    }
  }

  it("declares public access only for the allowlisted routes", () => {
    for (const { method, path, operation } of operations) {
      const key = `${method} ${path}`;
      const declaredPublic = Array.isArray(operation.security) && operation.security.length === 0;
      expect(declaredPublic, key).toBe(PUBLIC_OPERATIONS.has(key));
    }
  });

  it("every documented operation is routed (no 404 from the router)", async () => {
    for (const { method, path } of operations) {
      // Substitute syntactically valid UUIDs / numbers for path parameters.
      const url = path
        .replace(/\{partNumber\}/g, "1")
        .replace(/\{[^}]+\}/g, "0198ffff-0000-7000-8000-000000000000");
      const response = await ctx.app.inject({
        method: method as "GET" | "POST" | "PUT",
        url,
        headers: { "content-type": "application/json" },
        payload: method === "GET" ? undefined : "{}"
      });
      // 404 with title "Not found" is the router's not-found handler; any
      // other status (401/400/422/…) proves the route exists. Domain 404s
      // (e.g. "Property not found") also prove routing.
      const routed = response.statusCode !== 404 || (response.json()?.title ?? "") !== "Not found";
      expect(routed, `${method} ${path} -> ${response.statusCode}`).toBe(true);
    }
  });
});
