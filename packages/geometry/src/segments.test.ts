import { describe, expect, it } from "vitest";

import {
  assembleClosedLoop,
  offsetAlongSegment,
  segmentFromCenteredTransform
} from "./segments.js";

describe("segmentFromCenteredTransform", () => {
  it("derives endpoints from a centered wall transform", () => {
    // Wall of width 3.6 centered at (1.8, y, 0), local X = world X.
    const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.8, 1.22, 0, 1];
    const seg = segmentFromCenteredTransform(3.6, t);
    expect(seg.start.x).toBeCloseTo(0);
    expect(seg.start.y).toBeCloseTo(0);
    expect(seg.end.x).toBeCloseTo(3.6);
    expect(seg.end.y).toBeCloseTo(0);
  });

  it("handles rotated walls (local X = world -Z)", () => {
    const t = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3.6, 1.22, 1.5, 1];
    const seg = segmentFromCenteredTransform(3.0, t);
    expect(seg.start.y).toBeCloseTo(3.0);
    expect(seg.end.y).toBeCloseTo(0.0);
    expect(seg.start.x).toBeCloseTo(3.6);
  });
});

describe("offsetAlongSegment", () => {
  it("projects a point onto the segment direction", () => {
    const seg = { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } };
    expect(offsetAlongSegment(seg, { x: 1.5, y: 0.2 })).toBeCloseTo(1.5);
  });
});

describe("assembleClosedLoop", () => {
  const rect = [
    { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
    { start: { x: 4, y: 0 }, end: { x: 4, y: 3 } },
    { start: { x: 4, y: 3 }, end: { x: 0, y: 3 } },
    { start: { x: 0, y: 3 }, end: { x: 0, y: 0 } }
  ];

  it("assembles a rectangle into a CCW polygon with area", () => {
    const result = assembleClosedLoop(rect);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.polygon).toHaveLength(4);
      expect(result.areaM2).toBeCloseTo(12);
    }
  });

  it("tolerates slightly sloppy corners", () => {
    const sloppy = rect.map((s, i) =>
      i === 1 ? { start: { x: 4.03, y: 0.02 }, end: { x: 3.98, y: 3.01 } } : s
    );
    const result = assembleClosedLoop(sloppy, 0.05);
    expect(result.ok).toBe(true);
  });

  it("reports open loops instead of inventing geometry", () => {
    const open = rect.slice(0, 3);
    const result = assembleClosedLoop(open);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("open_or_branching_corners");
    }
  });

  it("rejects too-few segments", () => {
    expect(assembleClosedLoop(rect.slice(0, 2)).ok).toBe(false);
  });
});
