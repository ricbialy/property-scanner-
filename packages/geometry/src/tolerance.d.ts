/** Central geometry tolerances. Never compare coordinates with exact equality. */
/** Length tolerance in meters (1 mm). */
export declare const EPSILON_LENGTH_M = 0.001;
/** Angular tolerance in radians (~0.0057°). */
export declare const EPSILON_ANGLE_RAD = 0.0001;
/** Area tolerance in square meters. */
export declare const EPSILON_AREA_M2 = 0.000001;
export declare function nearlyEqual(a: number, b: number, epsilon?: number): boolean;
export declare function nearlyZero(a: number, epsilon?: number): boolean;
//# sourceMappingURL=tolerance.d.ts.map
