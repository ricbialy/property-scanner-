/** 2D point/vector in the floor-local plan coordinate system, meters. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}
/** 3D point/vector in the right-handed, Y-up source coordinate system, meters. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export declare function vec2(x: number, y: number): Vec2;
export declare function add(a: Vec2, b: Vec2): Vec2;
export declare function sub(a: Vec2, b: Vec2): Vec2;
export declare function scale(a: Vec2, s: number): Vec2;
export declare function dot(a: Vec2, b: Vec2): number;
/** 2D cross product z-component; positive when b is CCW from a. */
export declare function cross(a: Vec2, b: Vec2): number;
export declare function length(a: Vec2): number;
export declare function distance(a: Vec2, b: Vec2): number;
export declare function nearlyEqualVec2(a: Vec2, b: Vec2, epsilon?: number): boolean;
export declare function normalize(a: Vec2): Vec2;
/**
 * Project a 3D source-space point to the canonical 2D floor plan:
 * x = worldX, y = worldZ. The vertical (Y) component is returned separately
 * as elevation above the floor datum.
 */
export declare function projectToPlan(p: Vec3): {
  point: Vec2;
  elevation: number;
};
//# sourceMappingURL=vec.d.ts.map
