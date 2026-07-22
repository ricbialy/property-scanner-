import { describe, expect, it } from "vitest";

import { isLegalTransition } from "./repositories/scanSessions.js";

describe("scan session state machine", () => {
  it("allows the happy path", () => {
    expect(isLegalTransition("draft", "capturing")).toBe(true);
    expect(isLegalTransition("capturing", "local_review")).toBe(true);
    expect(isLegalTransition("local_review", "queued_upload")).toBe(true);
    expect(isLegalTransition("queued_upload", "uploading")).toBe(true);
    expect(isLegalTransition("uploading", "processing")).toBe(true);
    expect(isLegalTransition("processing", "needs_review")).toBe(true);
    expect(isLegalTransition("needs_review", "completed")).toBe(true);
  });

  it("allows retryable upload failure back to queued_upload", () => {
    expect(isLegalTransition("uploading", "queued_upload")).toBe(true);
  });

  it("allows processing failure", () => {
    expect(isLegalTransition("processing", "failed")).toBe(true);
  });

  it("rejects illegal shortcuts", () => {
    expect(isLegalTransition("draft", "completed")).toBe(false);
    expect(isLegalTransition("draft", "processing")).toBe(false);
    expect(isLegalTransition("completed", "draft")).toBe(false);
    expect(isLegalTransition("failed", "processing")).toBe(false);
  });
});
