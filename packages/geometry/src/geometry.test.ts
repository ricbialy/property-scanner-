import { describe, expect, it } from "vitest";

import {
  applyTransform,
  ensureCcw,
  formatFeetInches,
  IDENTITY_MAT4,
  isCcw,
  multiply,
  nearlyEqual,
  nearlyEqualVec2,
  polygonAreaM2,
  polygonPerimeterM,
  projectToPlan,
  signedArea,
  transformSanity
} from "./index.js";

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 }
];

describe("tolerance", () => {
  it("treats sub-millimeter differences as equal", () => {
    expect(nearlyEqual(1.0004, 1.0009)).toBe(true);
    expect(nearlyEqual(1.0, 1.002)).toBe(false);
    expect(nearlyEqualVec2({ x: 0, y: 0 }, { x: 0.0005, y: 0 })).toBe(true);
  });
});

describe("projection", () => {
  it("projects 3D Y-up points to X/Z plan coordinates with separate elevation", () => {
    const { point, elevation } = projectToPlan({ x: 1.5, y: 2.7, z: -3.25 });
    expect(point).toEqual({ x: 1.5, y: -3.25 });
    expect(elevation).toBe(2.7);
  });
});

describe("polygon winding", () => {
  it("computes signed area with CCW positive", () => {
    expect(signedArea(square)).toBeCloseTo(4);
    expect(isCcw(square)).toBe(true);
    expect(isCcw([...square].reverse())).toBe(false);
  });

  it("normalizes winding to CCW", () => {
    const fixed = ensureCcw([...square].reverse());
    expect(signedArea(fixed)).toBeCloseTo(4);
  });

  it("rejects degenerate polygons", () => {
    expect(() =>
      ensureCcw([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 }
      ])
    ).toThrow(/degenerate/);
  });

  it("computes area and perimeter", () => {
    expect(polygonAreaM2(square)).toBeCloseTo(4);
    expect(polygonPerimeterM(square)).toBeCloseTo(8);
  });
});

describe("transforms (column-major)", () => {
  // Column-major translation by (1, 2, 3): translation lives in indices 12..14.
  const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1];

  it("applies identity", () => {
    expect(applyTransform(IDENTITY_MAT4, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("applies column-major translation", () => {
    expect(applyTransform(translate, { x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("multiplies matrices", () => {
    const twice = multiply(translate, translate);
    expect(applyTransform(twice, { x: 0, y: 0, z: 0 })).toEqual({ x: 2, y: 4, z: 6 });
  });

  it("flags insane transforms", () => {
    expect(transformSanity(IDENTITY_MAT4).ok).toBe(true);
    const mirrored = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(transformSanity(mirrored).reasons).toContain("linear_block_degenerate_or_mirrored");
    expect(transformSanity([1, 2, 3]).ok).toBe(false);
  });
});

describe("imperial display formatting", () => {
  it("formats meters as feet and fractional inches", () => {
    expect(formatFeetInches(0.9144).text).toBe("3'-0\"");
    expect(formatFeetInches(1).text).toBe("3'-3 3/8\"");
    expect(formatFeetInches(0.0254 * 14.5, 2).text).toBe("1'-2 1/2\"");
  });

  it("carries fraction overflow into inches and feet", () => {
    // 11.99 inches at nearest 1/8 rounds to 12" → 1'-0"
    expect(formatFeetInches(0.0254 * 11.99).text).toBe("1'-0\"");
  });
});
