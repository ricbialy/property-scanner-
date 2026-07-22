/**
 * Browser API client for the Phase 1 development shell.
 *
 * Authentication: in AUTH_MODE=dev the token is `dev_<userId>` and is safe to
 * expose locally. When Clerk credentials are configured, this client must be
 * fed a real Clerk session token instead (see docs/operations/local-development.md);
 * the dev token path is refused by the API in production.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
export const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "user_demo_owner";

export interface ApiError {
  title: string;
  status: number;
  detail?: string;
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    organizationId?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer dev_${DEV_USER_ID}`,
      ...(options.organizationId ? { "x-organization-id": options.organizationId } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  if (!response.ok) {
    let problem: ApiError = { title: response.statusText, status: response.status };
    try {
      problem = (await response.json()) as ApiError;
    } catch {
      // keep the fallback problem
    }
    throw new Error(
      `${problem.status} ${problem.title}${problem.detail ? `: ${problem.detail}` : ""}`
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
