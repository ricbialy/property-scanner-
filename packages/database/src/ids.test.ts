import { describe, expect, it } from "vitest";

import { uuidv7 } from "./ids.js";

describe("uuidv7", () => {
  it("produces RFC 9562 version-7 UUIDs", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is time-ordered across milliseconds", () => {
    const earlier = uuidv7(1_000_000);
    const later = uuidv7(2_000_000);
    expect(earlier < later).toBe(true);
  });

  it("does not collide across many generations", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });
});
