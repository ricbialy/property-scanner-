import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthenticatedIdentity {
  /** Identity-provider user id (Clerk `sub`). */
  userId: string;
  mode: "dev" | "clerk";
}

export interface TokenVerifier {
  verify(bearerToken: string): Promise<AuthenticatedIdentity>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const DEV_TOKEN_PATTERN = /^dev_[A-Za-z0-9_-]{1,120}$/;

/**
 * Development-only verifier: accepts "Bearer dev_<userId>". Refused entirely
 * unless AUTH_MODE=dev, which packages/config forbids in production.
 */
export function createDevVerifier(): TokenVerifier {
  return {
    async verify(token: string): Promise<AuthenticatedIdentity> {
      if (!DEV_TOKEN_PATTERN.test(token)) {
        throw new AuthError("Invalid development token");
      }
      return { userId: token, mode: "dev" };
    }
  };
}

export interface ClerkVerifierOptions {
  issuer: string;
  /** Origins allowed as `azp` (authorized party); empty list skips the check. */
  authorizedParties?: string[];
}

/**
 * Clerk session-token verification per Clerk's manual JWT guidance:
 * signature against the instance JWKS, issuer, expiry, and (when configured)
 * the authorized party claim.
 */
export function createClerkVerifier(options: ClerkVerifierOptions): TokenVerifier {
  const jwks = createRemoteJWKSet(
    new URL(`${options.issuer.replace(/\/$/, "")}/.well-known/jwks.json`)
  );
  return {
    async verify(token: string): Promise<AuthenticatedIdentity> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, jwks, { issuer: options.issuer }));
      } catch (error) {
        throw new AuthError(`Token verification failed: ${(error as Error).message}`);
      }
      const azp = payload.azp as string | undefined;
      const allowed = options.authorizedParties ?? [];
      if (allowed.length > 0 && azp && !allowed.includes(azp)) {
        throw new AuthError("Token authorized party mismatch");
      }
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new AuthError("Token missing subject");
      }
      return { userId: payload.sub, mode: "clerk" };
    }
  };
}

export function createVerifier(config: {
  authMode: "dev" | "clerk";
  clerkIssuer?: string | undefined;
  authorizedParties?: string[];
}): TokenVerifier {
  if (config.authMode === "clerk") {
    if (!config.clerkIssuer) {
      throw new Error("clerkIssuer is required for AUTH_MODE=clerk");
    }
    return createClerkVerifier({
      issuer: config.clerkIssuer,
      ...(config.authorizedParties ? { authorizedParties: config.authorizedParties } : {})
    });
  }
  return createDevVerifier();
}
