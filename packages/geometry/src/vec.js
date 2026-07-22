import { EPSILON_LENGTH_M, nearlyZero } from "./tolerance.js";
export function vec2(x, y) {
    return { x, y };
}
export function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}
export function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}
export function scale(a, s) {
    return { x: a.x * s, y: a.y * s };
}
export function dot(a, b) {
    return a.x * b.x + a.y * b.y;
}
/** 2D cross product z-component; positive when b is CCW from a. */
export function cross(a, b) {
    return a.x * b.y - a.y * b.x;
}
export function length(a) {
    return Math.hypot(a.x, a.y);
}
export function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
export function nearlyEqualVec2(a, b, epsilon = EPSILON_LENGTH_M) {
    return distance(a, b) <= epsilon;
}
export function normalize(a) {
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
export function projectToPlan(p) {
    return { point: { x: p.x, y: p.z }, elevation: p.y };
}
//# sourceMappingURL=vec.js.map