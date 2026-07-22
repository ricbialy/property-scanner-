/** Display-only unit conversion. Canonical storage is always meters. */

export const METERS_PER_INCH = 0.0254;
export const INCHES_PER_FOOT = 12;

export function metersToInches(meters: number): number {
  return meters / METERS_PER_INCH;
}

export function inchesToMeters(inches: number): number {
  return inches * METERS_PER_INCH;
}

export interface FeetInchesFraction {
  readonly feet: number;
  readonly inches: number;
  /** Numerator of the fractional inch, already reduced. */
  readonly numerator: number;
  readonly denominator: number;
  readonly text: string;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Format meters as feet + fractional inches for display, rounding to a
 * tenant-configured increment denominator (e.g. 8 → nearest 1/8").
 * This is presentation only; it must never round-trip back into storage.
 */
export function formatFeetInches(meters: number, denominator: number = 8): FeetInchesFraction {
  if (!Number.isInteger(denominator) || denominator < 1) {
    throw new Error("denominator must be a positive integer");
  }
  const sign = meters < 0 ? "-" : "";
  const totalInches = Math.abs(metersToInches(meters));
  let sixteenths = Math.round(totalInches * denominator);
  let feet = Math.floor(sixteenths / (denominator * INCHES_PER_FOOT));
  sixteenths -= feet * denominator * INCHES_PER_FOOT;
  let inches = Math.floor(sixteenths / denominator);
  let numerator = sixteenths - inches * denominator;
  if (numerator === denominator) {
    numerator = 0;
    inches += 1;
  }
  if (inches === INCHES_PER_FOOT) {
    inches = 0;
    feet += 1;
  }
  const reduced = numerator === 0 ? 1 : gcd(numerator, denominator);
  const num = numerator / reduced;
  const den = denominator / reduced;
  const fractionText = numerator === 0 ? "" : ` ${num}/${den}`;
  const text = `${sign}${feet}'-${inches}${fractionText}"`;
  return { feet, inches, numerator: num, denominator: numerator === 0 ? denominator : den, text };
}
