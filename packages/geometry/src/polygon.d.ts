import type { Vec2 } from "./vec.js";
/**
 * Signed area via the shoelace formula. Positive area means counter-clockwise
 * winding, which is the canonical winding for room boundary polygons.
 */
export declare function signedArea(polygon: readonly Vec2[]): number;
export declare function isCcw(polygon: readonly Vec2[]): boolean;
/** Return the polygon in canonical CCW winding, reversing when necessary. */
export declare function ensureCcw(polygon: readonly Vec2[]): Vec2[];
export declare function polygonAreaM2(polygon: readonly Vec2[]): number;
export declare function polygonPerimeterM(polygon: readonly Vec2[]): number;
//# sourceMappingURL=polygon.d.ts.map
