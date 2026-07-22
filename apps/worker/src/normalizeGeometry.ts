import type { PlanRevisionPayload, ValidationFinding } from "@propertyscan/contracts";
import { NOT_PROCESSED } from "@propertyscan/contracts";
import {
  applyTransform,
  assembleClosedLoop,
  IDENTITY_MAT4,
  multiply,
  offsetAlongSegment,
  projectToPlan,
  segmentFromCenteredTransform,
  type Mat4ColumnMajor,
  type Segment2
} from "@propertyscan/geometry";
import { uuidv7 } from "@propertyscan/database";

import { confidenceLevel, type RoomplanRoom } from "./roomplanAdapter.js";

export interface RoomToNormalize {
  /** Manifest room id (matches the RoomPlan capture identifier). */
  roomId: string;
  name: string | null;
  captured: RoomplanRoom;
  /** World transform from the multiroom structure result, when present. */
  structureTransform?: readonly number[];
}

export interface NormalizedGeometry {
  rooms: PlanRevisionPayload["rooms"];
  walls: PlanRevisionPayload["walls"];
  openings: PlanRevisionPayload["openings"];
  findings: ValidationFinding[];
}

const OPENING_KINDS = [
  { key: "windows", type: "window" },
  { key: "doors", type: "door" },
  { key: "openings", type: "open_passage" }
] as const;

/**
 * Normalize RoomPlan surfaces into the canonical 2D plan model (spec §7):
 * wall segments from centered transforms, room boundaries assembled from wall
 * loops, and openings attached to host walls with offsets along the wall.
 * Anything that cannot be derived stays explicitly `not_processed` with a
 * finding — geometry is never invented.
 */
export function normalizeGeometry(inputs: RoomToNormalize[]): NormalizedGeometry {
  const findings: ValidationFinding[] = [];
  const rooms: PlanRevisionPayload["rooms"] = [];
  const walls: PlanRevisionPayload["walls"] = [];
  const openings: PlanRevisionPayload["openings"] = [];

  for (const input of inputs) {
    const roomT: Mat4ColumnMajor = (input.structureTransform as Mat4ColumnMajor) ?? IDENTITY_MAT4;
    const payloadRoomId = uuidv7();

    // Walls. Keyed by RoomPlan source identifier; payload ids are freshly
    // minted per revision (source ids are preserved as sourceId references).
    const wallSegments = new Map<string, Segment2>();
    const wallIdBySource = new Map<string, string>();
    const wallConfidences: Array<"high" | "medium" | "low" | "unknown"> = [];
    for (const wall of input.captured.walls) {
      if (!wall.transform) {
        findings.push({
          code: "wall_missing_transform",
          severity: "warning",
          message: `wall ${wall.identifier} has no transform; excluded from geometry`,
          subjectType: "wall",
          subjectId: wall.identifier
        });
        continue;
      }
      const widthM = wall.dimensions[0] ?? 0;
      if (!(widthM > 0)) {
        findings.push({
          code: "wall_zero_width",
          severity: "warning",
          message: `wall ${wall.identifier} has non-positive width; excluded from geometry`,
          subjectType: "wall",
          subjectId: wall.identifier
        });
        continue;
      }
      const worldT = multiply(roomT, wall.transform);
      const segment = segmentFromCenteredTransform(widthM, worldT);
      const sourceId = wall.identifier.toLowerCase();
      const wallId = uuidv7();
      wallSegments.set(sourceId, segment);
      wallIdBySource.set(sourceId, wallId);
      const confidence = confidenceLevel(wall.confidence);
      wallConfidences.push(confidence);
      const thickness = wall.dimensions[2] ?? 0;
      const height = wall.dimensions[1] ?? 0;
      walls.push({
        id: wallId,
        sourceId,
        roomId: payloadRoomId,
        start: segment.start,
        end: segment.end,
        thicknessM: thickness > 0 ? thickness : null,
        heightM: height > 0 ? height : null,
        source: "roomplan",
        confidence
      });
    }

    // Room boundary from the wall loop.
    let boundary: PlanRevisionPayload["rooms"][number]["boundary"] = NOT_PROCESSED;
    let areaM2: PlanRevisionPayload["rooms"][number]["areaM2"] = NOT_PROCESSED;
    const loop = assembleClosedLoop([...wallSegments.values()]);
    if (loop.ok) {
      boundary = loop.polygon;
      areaM2 = loop.areaM2;
    } else {
      findings.push({
        code: "room_not_closed",
        severity: "warning",
        message: `room ${input.roomId} walls do not form a closed boundary (${loop.reasons.join(", ")}); boundary left not_processed`,
        subjectType: "room",
        subjectId: input.roomId
      });
    }

    const roomConfidence = wallConfidences.includes("low")
      ? "low"
      : wallConfidences.includes("medium")
        ? "medium"
        : wallConfidences.includes("high")
          ? "high"
          : "unknown";

    rooms.push({
      id: payloadRoomId,
      name: input.name,
      sourceRoomId: input.roomId,
      boundary,
      areaM2,
      confidence: roomConfidence
    });

    // Openings (windows, doors, open passages).
    for (const kind of OPENING_KINDS) {
      for (const surface of input.captured[kind.key]) {
        const sourceId = surface.identifier.toLowerCase();
        const openingId = uuidv7();
        const widthM = surface.dimensions[0] ?? 0;
        const heightM = surface.dimensions[1] ?? 0;
        if (!surface.transform || !(widthM > 0) || !(heightM > 0)) {
          findings.push({
            code: "opening_missing_geometry",
            severity: "warning",
            message: `${kind.type} ${surface.identifier} lacks transform or dimensions; fields left not_processed`,
            subjectType: "opening",
            subjectId: surface.identifier
          });
          openings.push({
            id: openingId,
            sourceId,
            type: kind.type,
            wallId: null,
            offsetAlongWallM: NOT_PROCESSED,
            widthM: widthM > 0 ? widthM : NOT_PROCESSED,
            heightM: heightM > 0 ? heightM : NOT_PROCESSED,
            sillHeightM: null,
            roomIds: [payloadRoomId],
            confidence: confidenceLevel(surface.confidence),
            verification: "unverified"
          });
          continue;
        }

        const worldT = multiply(roomT, surface.transform);
        const { point: center, elevation } = projectToPlan(
          applyTransform(worldT, { x: 0, y: 0, z: 0 })
        );

        const hostSourceId = surface.parentIdentifier?.toLowerCase() ?? null;
        const hostSegment = hostSourceId ? wallSegments.get(hostSourceId) : undefined;
        if (!hostSegment) {
          findings.push({
            code: "opening_unattached",
            severity: "warning",
            message: `${kind.type} ${surface.identifier} has no resolvable host wall; must be reattached or marked unresolved in review`,
            subjectType: "opening",
            subjectId: surface.identifier
          });
        }

        const sillHeightM =
          kind.type === "window"
            ? Math.max(0, elevation - heightM / 2)
            : kind.type === "door"
              ? 0
              : null;

        openings.push({
          id: openingId,
          sourceId,
          type: kind.type,
          wallId: hostSegment ? (wallIdBySource.get(hostSourceId!) ?? null) : null,
          offsetAlongWallM: hostSegment ? offsetAlongSegment(hostSegment, center) : NOT_PROCESSED,
          widthM,
          heightM,
          sillHeightM,
          roomIds: [payloadRoomId],
          confidence: confidenceLevel(surface.confidence),
          verification: "unverified"
        });
      }
    }
  }

  return { rooms, walls, openings, findings };
}
