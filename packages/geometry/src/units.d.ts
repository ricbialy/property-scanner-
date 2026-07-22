/** Display-only unit conversion. Canonical storage is always meters. */
export declare const METERS_PER_INCH = 0.0254;
export declare const INCHES_PER_FOOT = 12;
export declare function metersToInches(meters: number): number;
export declare function inchesToMeters(inches: number): number;
export interface FeetInchesFraction {
  readonly feet: number;
  readonly inches: number;
  /** Numerator of the fractional inch, already reduced. */
  readonly numerator: number;
  readonly denominator: number;
  readonly text: string;
}
/**
 * Format meters as feet + fractional inches for display, rounding to a
 * tenant-configured increment denominator (e.g. 8 → nearest 1/8").
 * This is presentation only; it must never round-trip back into storage.
 */
export declare function formatFeetInches(meters: number, denominator?: number): FeetInchesFraction;
//# sourceMappingURL=units.d.ts.map
