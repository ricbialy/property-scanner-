import { describe, expect, it } from "vitest";

import { createDevVerifier, createVerifier } from "./index.js";

describe("dev verifier", () => {
  it("accepts well-formed dev tokens and returns the user id", async () => {
    const verifier = createDevVerifier();
    await expect(verifier.verify("dev_user_demo_owner")).resolves.toEqual({
      userId: "dev_user_demo_owner",
      mode: "dev"
    });
  });

  it("rejects malformed tokens", async () => {
    const verifier = createDevVerifier();
    await expect(verifier.verify("eyJhbGciOi...")).rejects.toThrow(/Invalid development token/);
    await expect(verifier.verify("")).rejects.toThrow();
    await expect(verifier.verify("dev_")).rejects.toThrow();
  });
});

describe("createVerifier", () => {
  it("requires an issuer for clerk mode", () => {
    expect(() => createVerifier({ authMode: "clerk" })).toThrow(/clerkIssuer/);
  });
});
