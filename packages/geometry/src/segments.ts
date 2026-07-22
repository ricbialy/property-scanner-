import { ensureCcw, polygonAreaM2 } from "./polygon.js";
import { EPSILON_LENGTH_M } from "./tolerance.js";
import { applyTransform, type Mat4ColumnMajor } from "./transform.js";
import { distance, dot, normalize, projectToPlan, sub, type Vec2 } from "./vec.js";

export interface Segment2 {
  readonly start: Vec2;
  readonly end: Vec2;
}

/**
 * Plan-projected segment for a surface whose local extent spans `widthM`
 * along its local X axis, centered on its transform origin (RoomPlan wall
 * convention). The transform maps surface-local space to world space.
 */
export function segmentFromCenteredTransform(widthM: number, transform: Mat4ColumnMajor): Segment2 {
  const half = widthM / 2;
  const a = applyTransform(transform, { x: -half, y: 0, z: 0 });
  const b = applyTransform(transform, { x: half, y: 0, z: 0 });
  return { start: projectToPlan(a).point, end: projectToPlan(b).point };
}

/** Distance from the segment start to `point` projected onto the segment direction. */
export function offsetAlongSegment(segment: Segment2, point: Vec2): number {
  const dir = normalize(sub(segment.end, segment.start));
  return dot(sub(point, segment.start), dir);
}

export type LoopResult =
  { ok: true; polygon: Vec2[]; areaM2: number } | { ok: false; reasons: string[] };

/**
 * Assemble wall segments into a single closed room boundary by snapping
 * endpoints within `toleranceM`. Requirements for success: every corner joins
 * exactly two segment ends, and one walk visits every segment. Anything else
 * returns reasons instead of an invented polygon.
 */
export function assembleClosedLoop(
  segments: readonly Segment2[],
  toleranceM: number = 0.05
): LoopResult {
  if (segments.length < 3) {
    return { ok: false, reasons: ["fewer_than_three_segments"] };
  }

  // Cluster endpoints into nodes.
  const nodes: Vec2[] = [];
  const nodeOf = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i += 1) {
      if (distance(nodes[i]!, p) <= toleranceM) {
        return i;
      }
    }
    nodes.push(p);
    return nodes.length - 1;
  };

  const edges = segments.map((s) => ({ a: nodeOf(s.start), b: nodeOf(s.end) }));
  if (edges.some((e) => e.a === e.b)) {
    return { ok: false, reasons: ["degenerate_segment"] };
  }

  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  if ([...degree.values()].some((d) => d !== 2)) {
    return { ok: false, reasons: ["open_or_branching_corners"] };
  }
  if (nodes.length !== segments.length) {
    return { ok: false, reasons: ["corner_segment_count_mismatch"] };
  }

  // Walk the loop.
  const used = new Set<number>();
  const order: number[] = [];
  let current = edges[0]!.a;
  order.push(current);
  while (used.size < edges.length) {
    const nextEdgeIndex = edges.findIndex(
      (e, i) => !used.has(i) && (e.a === current || e.b === current)
    );
    if (nextEdgeIndex === -1) {
      return { ok: false, reasons: ["disconnected_segments"] };
    }
    used.add(nextEdgeIndex);
    const edge = edges[nextEdgeIndex]!;
    current = edge.a === current ? edge.b : edge.a;
    order.push(current);
  }
  if (order[0] !== order[order.length - 1]) {
    return { ok: false, reasons: ["loop_does_not_close"] };
  }
  order.pop();
  if (order.length !== segments.length) {
    return { ok: false, reasons: ["disconnected_segments"] };
  }

  try {
    const polygon = ensureCcw(order.map((i) => nodes[i]!));
    const areaM2 = polygonAreaM2(polygon);
    if (areaM2 <= EPSILON_LENGTH_M) {
      return { ok: false, reasons: ["near_zero_area"] };
    }
    return { ok: true, polygon, areaM2 };
  } catch {
    return { ok: false, reasons: ["degenerate_polygon"] };
  }
}
