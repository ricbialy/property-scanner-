import { EPSILON_AREA_M2 } from "./tolerance.js";
/**
 * Signed area via the shoelace formula. Positive area means counter-clockwise
 * winding, which is the canonical winding for room boundary polygons.
 */
export function signedArea(polygon) {
    if (polygon.length < 3) {
        return 0;
    }
    let sum = 0;
    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
}
export function isCcw(polygon) {
    return signedArea(polygon) > EPSILON_AREA_M2;
}
/** Return the polygon in canonical CCW winding, reversing when necessary. */
export function ensureCcw(polygon) {
    const area = signedArea(polygon);
    if (Math.abs(area) <= EPSILON_AREA_M2) {
        throw new Error("Polygon is degenerate (near-zero area)");
    }
    return area > 0 ? [...polygon] : [...polygon].reverse();
}
export function polygonAreaM2(polygon) {
    return Math.abs(signedArea(polygon));
}
export function polygonPerimeterM(polygon) {
    if (polygon.length < 2) {
        return 0;
    }
    let sum = 0;
    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        sum += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return sum;
}
//# sourceMappingURL=polygon.js.map