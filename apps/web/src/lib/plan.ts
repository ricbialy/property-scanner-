/** Shared plan types + display helpers for the review UI. */

export interface Point2 {
  x: number;
  y: number;
}

export type NotProcessed = "not_processed";

export interface PlanRoom {
  id: string;
  name: string | null;
  sourceRoomId: string;
  boundary: Point2[] | NotProcessed;
  areaM2: number | NotProcessed;
  confidence: string;
}

export interface PlanWall {
  id: string;
  roomId: string;
  start: Point2 | NotProcessed;
  end: Point2 | NotProcessed;
  thicknessM: number | null;
  heightM: number | null;
  source: string;
  confidence: string;
}

export interface PlanOpening {
  id: string;
  type: "window" | "door" | "open_passage" | "unknown";
  wallId: string | null;
  offsetAlongWallM: number | NotProcessed;
  widthM: number | NotProcessed;
  heightM: number | NotProcessed;
  sillHeightM: number | NotProcessed | null;
  roomIds: string[];
  confidence: string;
  verification: string;
}

export interface Finding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface PlanPayload {
  rooms: PlanRoom[];
  walls: PlanWall[];
  openings: PlanOpening[];
  validationFindings: Finding[];
}

export interface PlanResponse {
  id: string;
  floorId: string;
  scanSessionId: string | null;
  currentRevisionId: string | null;
  currentRevision: {
    id: string;
    status: string;
    version: number;
    authorType: string;
    reason: string;
    payload: PlanPayload;
  } | null;
}

const METERS_PER_INCH = 0.0254;

/** Display-only: meters -> feet'-inches" rounded to nearest 1/8". */
export function toFeetInches(valueM: number | NotProcessed | null): string {
  if (typeof valueM !== "number") return "—";
  const totalEighths = Math.round((valueM / METERS_PER_INCH) * 8);
  let feet = Math.floor(totalEighths / (12 * 8));
  let inches = Math.floor((totalEighths - feet * 96) / 8);
  let eighths = totalEighths - feet * 96 - inches * 8;
  if (eighths === 8) {
    eighths = 0;
    inches += 1;
  }
  if (inches === 12) {
    inches = 0;
    feet += 1;
  }
  const frac = eighths === 0 ? "" : ` ${eighths % 2 === 0 ? `${eighths / 2}/4` : `${eighths}/8`}`;
  const fracNorm = frac.replace(" 2/4", " 1/2");
  return `${feet}'-${inches}${fracNorm}"`;
}

export function inchesToMeters(inches: number): number {
  return inches * METERS_PER_INCH;
}

export function metersToInches(m: number): number {
  return m / METERS_PER_INCH;
}
