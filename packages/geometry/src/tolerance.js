/** Central geometry tolerances. Never compare coordinates with exact equality. */
/** Length tolerance in meters (1 mm). */
export const EPSILON_LENGTH_M = 1e-3;
/** Angular tolerance in radians (~0.0057°). */
export const EPSILON_ANGLE_RAD = 1e-4;
/** Area tolerance in square meters. */
export const EPSILON_AREA_M2 = 1e-6;
export function nearlyEqual(a, b, epsilon = EPSILON_LENGTH_M) {
    return Math.abs(a - b) <= epsilon;
}
export function nearlyZero(a, epsilon = EPSILON_LENGTH_M) {
    return Math.abs(a) <= epsilon;
}
//# sourceMappingURL=tolerance.js.map