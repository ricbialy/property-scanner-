export interface AuthenticatedIdentity {
  /** Identity-provider user id (Clerk `sub`). */
  userId: string;
  mode: "dev" | "clerk";
}
export interface TokenVerifier {
  verify(bearerToken: string): Promise<AuthenticatedIdentity>;
}
export declare class AuthError extends Error {
  constructor(message: string);
}
/**
 * Development-only verifier: accepts "Bearer dev_<userId>". Refused entirely
 * unless AUTH_MODE=dev, which packages/config forbids in production.
 */
export declare function createDevVerifier(): TokenVerifier;
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
export declare function createClerkVerifier(options: ClerkVerifierOptions): TokenVerifier;
export declare function createVerifier(config: {
  authMode: "dev" | "clerk";
  clerkIssuer?: string | undefined;
  authorizedParties?: string[];
}): TokenVerifier;
//# sourceMappingURL=index.d.ts.map
