import { EPSILON_LENGTH_M, nearlyZero } from "./tolerance.js";

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

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product z-component; positive when b is CCW from a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearlyEqualVec2(a: Vec2, b: Vec2, epsilon: number = EPSILON_LENGTH_M): boolean {
  return distance(a, b) <= epsilon;
}

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  if (nearlyZero(len)) {
    throw new Error("Cannot normalize a near-zero-length vector");
  }
  return { x: a.x / len, y: a.y / len };
}

/**
 * Project a 3D source-space point to the canonical 2D floor plan:
 * x = worldX, y = worldZ. The vertical (Y) component is returned separately
 * as elevation above the floor datum.
 */
export function projectToPlan(p: Vec3): { point: Vec2; elevation: number } {
  return { point: { x: p.x, y: p.z }, elevation: p.y };
}
