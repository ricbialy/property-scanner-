"use client";

import type { PlanOpening, PlanPayload, Point2 } from "@/lib/plan";

const OPENING_COLORS: Record<string, string> = {
  window: "#1d6fd1",
  door: "#b06a10",
  open_passage: "#5b8a3c",
  unknown: "#888888"
};

/** Read-only 2D floor plan rendered from the revision payload (meters). */
export function FloorPlanSvg({
  payload,
  selectedOpeningId,
  onSelectOpening
}: {
  payload: PlanPayload;
  selectedOpeningId: string | null;
  onSelectOpening: (id: string) => void;
}) {
  const points: Point2[] = [];
  for (const room of payload.rooms) {
    if (Array.isArray(room.boundary)) points.push(...room.boundary);
  }
  for (const wall of payload.walls) {
    if (typeof wall.start === "object") points.push(wall.start);
    if (typeof wall.end === "object") points.push(wall.end);
  }
  if (points.length === 0) {
    return <p>No renderable geometry — see findings below.</p>;
  }
  const pad = 0.6;
  const minX = Math.min(...points.map((p) => p.x)) - pad;
  const maxX = Math.max(...points.map((p) => p.x)) + pad;
  const minY = Math.min(...points.map((p) => p.y)) - pad;
  const maxY = Math.max(...points.map((p) => p.y)) + pad;

  const wallById = new Map(payload.walls.map((w) => [w.id, w]));

  function openingMarker(opening: PlanOpening) {
    const wall = opening.wallId ? wallById.get(opening.wallId) : undefined;
    if (!wall || typeof wall.start !== "object" || typeof wall.end !== "object") return null;
    if (typeof opening.offsetAlongWallM !== "number" || typeof opening.widthM !== "number") {
      return null;
    }
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const cx = wall.start.x + ux * opening.offsetAlongWallM;
    const cy = wall.start.y + uy * opening.offsetAlongWallM;
    const half = opening.widthM / 2;
    const selected = opening.id === selectedOpeningId;
    return (
      <line
        key={opening.id}
        x1={cx - ux * half}
        y1={cy - uy * half}
        x2={cx + ux * half}
        y2={cy + uy * half}
        stroke={OPENING_COLORS[opening.type] ?? "#888"}
        strokeWidth={selected ? 0.22 : 0.14}
        strokeLinecap="butt"
        style={{ cursor: "pointer" }}
        onClick={() => onSelectOpening(opening.id)}
        data-opening-id={opening.id}
      >
        <title>{`${opening.type} — click to select`}</title>
      </line>
    );
  }

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      style={{ width: "100%", maxHeight: 480, background: "#fbfbf8", border: "1px solid #dde2e8" }}
      role="img"
      aria-label="Floor plan"
    >
      {payload.rooms.map((room) =>
        Array.isArray(room.boundary) ? (
          <g key={room.id}>
            <polygon
              points={room.boundary.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="#eef1f5"
              stroke="none"
            />
            <text
              x={room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length}
              y={room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length}
              fontSize={0.32}
              textAnchor="middle"
              fill="#4a5561"
            >
              {room.name ?? "Unnamed"}
            </text>
          </g>
        ) : null
      )}
      {payload.walls.map((wall) =>
        typeof wall.start === "object" && typeof wall.end === "object" ? (
          <line
            key={wall.id}
            x1={wall.start.x}
            y1={wall.start.y}
            x2={wall.end.x}
            y2={wall.end.y}
            stroke="#2b3540"
            strokeWidth={0.09}
          />
        ) : null
      )}
      {payload.openings.map((opening) => openingMarker(opening))}
    </svg>
  );
}
