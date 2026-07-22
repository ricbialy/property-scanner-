import type { Vec3 } from "./vec.js";
/**
 * 4×4 transform serialized column-major (ARKit/simd convention):
 * element (row r, column c) is at index c*4 + r.
 */
export type Mat4ColumnMajor = readonly number[];
export declare const IDENTITY_MAT4: Mat4ColumnMajor;
export declare function isMat4(m: readonly number[]): m is Mat4ColumnMajor;
/** Apply a column-major 4×4 transform to a 3D point (w = 1). */
export declare function applyTransform(m: Mat4ColumnMajor, p: Vec3): Vec3;
/** Multiply two column-major matrices: result = a · b. */
export declare function multiply(a: Mat4ColumnMajor, b: Mat4ColumnMajor): Mat4ColumnMajor;
/**
 * Sanity checks for an imported source transform: finite, affine bottom row,
 * and a rotation/scale block whose determinant is positive and not degenerate.
 */
export declare function transformSanity(m: readonly number[]): {
  ok: boolean;
  reasons: string[];
};
//# sourceMappingURL=transform.d.ts.map
