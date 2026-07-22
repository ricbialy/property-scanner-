"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { api } from "@/lib/api";
import { Card, ErrorBanner } from "@/components/ui";
import { FloorPlanSvg } from "@/components/FloorPlanSvg";
import {
  inchesToMeters,
  metersToInches,
  toFeetInches,
  type PlanOpening,
  type PlanPayload,
  type PlanResponse
} from "@/lib/plan";

type Command =
  | { type: "renameRoom"; roomId: string; name: string }
  | {
      type: "updateOpening";
      openingId: string;
      patch: Partial<{
        openingType: PlanOpening["type"];
        widthM: number;
        heightM: number;
        sillHeightM: number | null;
      }>;
    }
  | {
      type: "addOpening";
      opening: {
        openingType: PlanOpening["type"];
        wallId: string | null;
        roomIds: string[];
        widthM: number;
        heightM: number;
        sillHeightM: number | null;
      };
    }
  | { type: "removeOpening"; openingId: string }
  | {
      type: "verifyOpening";
      openingId: string;
      source: "manual" | "laser";
      widthM?: number;
      heightM?: number;
      sillHeightM?: number;
    };

/** Local preview replay mirroring the server reducer's effects. */
function replay(base: PlanPayload, commands: Command[]): PlanPayload {
  const payload: PlanPayload = JSON.parse(JSON.stringify(base));
  let tempCounter = 0;
  for (const cmd of commands) {
    if (cmd.type === "renameRoom") {
      const room = payload.rooms.find((r) => r.id === cmd.roomId);
      if (room) room.name = cmd.name;
    } else if (cmd.type === "updateOpening") {
      const opening = payload.openings.find((o) => o.id === cmd.openingId);
      if (opening) {
        if (cmd.patch.openingType !== undefined) opening.type = cmd.patch.openingType;
        if (cmd.patch.widthM !== undefined) opening.widthM = cmd.patch.widthM;
        if (cmd.patch.heightM !== undefined) opening.heightM = cmd.patch.heightM;
        if (cmd.patch.sillHeightM !== undefined) opening.sillHeightM = cmd.patch.sillHeightM;
      }
    } else if (cmd.type === "addOpening") {
      tempCounter += 1;
      payload.openings.push({
        id: `temp-${tempCounter}`,
        type: cmd.opening.openingType,
        wallId: cmd.opening.wallId,
        offsetAlongWallM: "not_processed",
        widthM: cmd.opening.widthM,
        heightM: cmd.opening.heightM,
        sillHeightM: cmd.opening.sillHeightM,
        roomIds: cmd.opening.roomIds,
        confidence: "unknown",
        verification: "unverified"
      });
    } else if (cmd.type === "removeOpening") {
      payload.openings = payload.openings.filter((o) => o.id !== cmd.openingId);
    } else if (cmd.type === "verifyOpening") {
      const opening = payload.openings.find((o) => o.id === cmd.openingId);
      if (opening) {
        if (cmd.widthM !== undefined) opening.widthM = cmd.widthM;
        if (cmd.heightM !== undefined) opening.heightM = cmd.heightM;
        if (cmd.sillHeightM !== undefined) opening.sillHeightM = cmd.sillHeightM;
        opening.verification = "field_verified";
      }
    }
  }
  return payload;
}

function InchesInput({
  valueM,
  onCommit,
  label
}: {
  valueM: number | "not_processed" | null;
  onCommit: (meters: number) => void;
  label: string;
}) {
  const [text, setText] = useState(
    typeof valueM === "number" ? metersToInches(valueM).toFixed(1) : ""
  );
  return (
    <input
      aria-label={label}
      style={{ width: "4.5rem" }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const inches = Number(text);
        if (Number.isFinite(inches) && inches > 0) onCommit(inchesToMeters(inches));
      }}
      placeholder="in"
    />
  );
}

export default function PlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const search = useSearchParams();
  const organizationId = search.get("org") ?? "";

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<PlanResponse>(`/v1/plans/${planId}`, { organizationId });
      setPlan(result);
      setCommands([]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [planId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const base = plan?.currentRevision?.payload ?? null;
  const draft = useMemo(() => (base ? replay(base, commands) : null), [base, commands]);

  const push = (cmd: Command) => {
    setCommands((current) => [...current, cmd]);
    setNotice(null);
  };
  const undo = () => setCommands((current) => current.slice(0, -1));

  async function save() {
    if (!plan?.currentRevisionId || commands.length === 0) return;
    setBusy(true);
    try {
      // Commands referencing locally added openings cannot be sent (temp ids);
      // the reducer on the server assigns real ids, so verification of a new
      // opening happens after saving.
      await api(`/v1/plans/${planId}/revisions`, {
        method: "POST",
        organizationId,
        body: {
          parentRevisionId: plan.currentRevisionId,
          reason: "Browser corrections",
          commands
        }
      });
      setNotice("Corrections saved as a new draft revision.");
      await load();
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes("409")) {
        setNotice("Someone else saved a newer revision — reloaded it. Re-apply your changes.");
        await load();
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!plan?.currentRevisionId) return;
    if (commands.length > 0) {
      setNotice("Save your corrections before accepting.");
      return;
    }
    setBusy(true);
    try {
      await api(`/v1/plans/${planId}/revisions/${plan.currentRevisionId}/accept`, {
        method: "POST",
        organizationId
      });
      setNotice("Revision accepted. Exports and integrations now use this geometry.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !plan) {
    return <ErrorBanner message={error} />;
  }
  if (!plan || !draft || !plan.currentRevision) {
    return <p>Loading plan…</p>;
  }

  const roomNameById = new Map(draft.rooms.map((r) => [r.id, r.name ?? "Unnamed"]));
  const wallLabel = (wallId: string | null) => {
    if (!wallId) return "unattached";
    const wall = draft.walls.find((w) => w.id === wallId);
    return wall ? `wall in ${roomNameById.get(wall.roomId) ?? "?"}` : "unknown wall";
  };
  const revision = plan.currentRevision;

  return (
    <div>
      <ErrorBanner message={error} />
      {notice ? (
        <div
          role="status"
          style={{
            background: "#eef6ee",
            border: "1px solid #bcd9bc",
            borderRadius: 8,
            padding: "0.5rem 1rem",
            marginBottom: "1rem"
          }}
        >
          {notice}
        </div>
      ) : null}

      <Card title={`Plan revision v${revision.version} — ${revision.status}`}>
        <p style={{ fontSize: "0.85rem", opacity: 0.75 }}>
          {revision.authorType} · {revision.reason}. Measurements are preliminary estimates unless
          marked <strong>field_verified</strong>. Every save creates a new immutable revision — the
          original capture is never overwritten.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button onClick={() => void save()} disabled={busy || commands.length === 0}>
            Save {commands.length > 0 ? `${commands.length} correction(s)` : "corrections"}
          </button>
          <button onClick={undo} disabled={commands.length === 0}>
            Undo last
          </button>
          <button
            onClick={() => void accept()}
            disabled={busy || commands.length > 0 || revision.status === "accepted"}
          >
            {revision.status === "accepted" ? "Accepted ✓" : "Accept revision"}
          </button>
        </div>
      </Card>

      <Card title="Floor plan">
        <FloorPlanSvg
          payload={draft}
          selectedOpeningId={selectedOpeningId}
          onSelectOpening={setSelectedOpeningId}
        />
        <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>
          Blue = windows, orange = doors, green = open passages. Click an opening to select it in
          the table.
        </p>
      </Card>

      <Card title="Rooms">
        <ul style={{ listStyle: "none", padding: 0 }}>
          {draft.rooms.map((room) => (
            <li key={room.id} style={{ marginBottom: "0.4rem" }}>
              <input
                defaultValue={room.name ?? ""}
                aria-label={`Room name for ${room.id}`}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== (room.name ?? "")) {
                    push({ type: "renameRoom", roomId: room.id, name });
                  }
                }}
              />{" "}
              <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>
                {typeof room.areaM2 === "number"
                  ? `${(room.areaM2 * 10.7639).toFixed(0)} sq ft`
                  : "area not processed"}{" "}
                · confidence {room.confidence}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Openings (windows, doors, passages)">
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
            <thead>
              <tr>
                {[
                  "Type",
                  "Location",
                  "Width",
                  "Height",
                  "Sill",
                  "Source/Conf.",
                  "Verification",
                  ""
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "0.3rem",
                      borderBottom: "1px solid #dde2e8"
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draft.openings.map((opening) => (
                <tr
                  key={opening.id}
                  style={{
                    background: opening.id === selectedOpeningId ? "#fdf6e3" : undefined,
                    borderBottom: "1px solid #eef1f5"
                  }}
                  onClick={() => setSelectedOpeningId(opening.id)}
                >
                  <td style={{ padding: "0.3rem" }}>
                    <select
                      value={opening.type}
                      aria-label="Opening type"
                      disabled={opening.id.startsWith("temp-")}
                      onChange={(e) =>
                        push({
                          type: "updateOpening",
                          openingId: opening.id,
                          patch: { openingType: e.target.value as PlanOpening["type"] }
                        })
                      }
                    >
                      {["window", "door", "open_passage", "unknown"].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "0.3rem" }}>
                    {opening.roomIds.map((id) => roomNameById.get(id) ?? "?").join(", ")}
                    <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                      {wallLabel(opening.wallId)}
                    </div>
                  </td>
                  {(["widthM", "heightM", "sillHeightM"] as const).map((field) => (
                    <td key={field} style={{ padding: "0.3rem" }}>
                      <div>{toFeetInches(opening[field] ?? null)}</div>
                      {!opening.id.startsWith("temp-") ? (
                        <InchesInput
                          label={`${field} inches`}
                          valueM={opening[field] ?? null}
                          onCommit={(meters) =>
                            push({
                              type: "updateOpening",
                              openingId: opening.id,
                              patch: {
                                [field === "widthM"
                                  ? "widthM"
                                  : field === "heightM"
                                    ? "heightM"
                                    : "sillHeightM"]: meters
                              }
                            })
                          }
                        />
                      ) : null}
                    </td>
                  ))}
                  <td style={{ padding: "0.3rem" }}>{opening.confidence}</td>
                  <td style={{ padding: "0.3rem" }}>
                    <span
                      style={{
                        color: opening.verification === "field_verified" ? "#1d7a1d" : "#8a6d1a"
                      }}
                    >
                      {opening.verification}
                    </span>
                    {!opening.id.startsWith("temp-") &&
                    opening.verification !== "field_verified" ? (
                      verifying === opening.id ? (
                        <span style={{ marginLeft: "0.4rem" }}>
                          <button
                            onClick={() => {
                              push({
                                type: "verifyOpening",
                                openingId: opening.id,
                                source: "laser",
                                ...(typeof opening.widthM === "number"
                                  ? { widthM: opening.widthM }
                                  : {}),
                                ...(typeof opening.heightM === "number"
                                  ? { heightM: opening.heightM }
                                  : {}),
                                ...(typeof opening.sillHeightM === "number"
                                  ? { sillHeightM: opening.sillHeightM }
                                  : {})
                              });
                              setVerifying(null);
                            }}
                          >
                            laser
                          </button>{" "}
                          <button
                            onClick={() => {
                              push({
                                type: "verifyOpening",
                                openingId: opening.id,
                                source: "manual",
                                ...(typeof opening.widthM === "number"
                                  ? { widthM: opening.widthM }
                                  : {}),
                                ...(typeof opening.heightM === "number"
                                  ? { heightM: opening.heightM }
                                  : {}),
                                ...(typeof opening.sillHeightM === "number"
                                  ? { sillHeightM: opening.sillHeightM }
                                  : {})
                              });
                              setVerifying(null);
                            }}
                          >
                            tape
                          </button>
                        </span>
                      ) : (
                        <button
                          style={{ marginLeft: "0.4rem" }}
                          onClick={() => setVerifying(opening.id)}
                        >
                          Verify…
                        </button>
                      )
                    ) : null}
                  </td>
                  <td style={{ padding: "0.3rem" }}>
                    {!opening.id.startsWith("temp-") ? (
                      <button
                        onClick={() => push({ type: "removeOpening", openingId: opening.id })}
                      >
                        Remove
                      </button>
                    ) : (
                      <em>new</em>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddOpeningForm draft={draft} onAdd={(opening) => push({ type: "addOpening", opening })} />
        <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>
          Set corrected dimensions first (inches), then press <em>Verify…</em> and choose the
          measurement method — this records provenance and marks the opening field-verified.
        </p>
      </Card>

      <Card title="Quality findings">
        {draft.validationFindings.length === 0 ? (
          <p>No unresolved findings.</p>
        ) : (
          <ul>
            {draft.validationFindings.map((f, i) => (
              <li
                key={i}
                style={{
                  color:
                    f.severity === "error"
                      ? "#8a1f11"
                      : f.severity === "warning"
                        ? "#8a6d1a"
                        : "#4a5561"
                }}
              >
                [{f.severity}] {f.code}: {f.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Schedules planId={planId} organizationId={organizationId} revisionId={revision.id} />
    </div>
  );
}

function AddOpeningForm({
  draft,
  onAdd
}: {
  draft: PlanPayload;
  onAdd: (opening: {
    openingType: PlanOpening["type"];
    wallId: string | null;
    roomIds: string[];
    widthM: number;
    heightM: number;
    sillHeightM: number | null;
  }) => void;
}) {
  const [type, setType] = useState<PlanOpening["type"]>("window");
  const [wallId, setWallId] = useState<string>("");
  const [widthIn, setWidthIn] = useState("36");
  const [heightIn, setHeightIn] = useState("48");
  const [sillIn, setSillIn] = useState("30");
  const roomNameById = new Map(draft.rooms.map((r) => [r.id, r.name ?? "Unnamed"]));

  return (
    <div
      style={{
        display: "flex",
        gap: "0.4rem",
        flexWrap: "wrap",
        alignItems: "center",
        marginTop: "0.6rem"
      }}
    >
      <strong>Add missing opening:</strong>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as PlanOpening["type"])}
        aria-label="New opening type"
      >
        {["window", "door", "open_passage"].map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select value={wallId} onChange={(e) => setWallId(e.target.value)} aria-label="Host wall">
        <option value="">no wall (unresolved)</option>
        {draft.walls.map((w) => (
          <option key={w.id} value={w.id}>
            wall in {roomNameById.get(w.roomId) ?? "?"}
          </option>
        ))}
      </select>
      <input
        style={{ width: "4rem" }}
        value={widthIn}
        onChange={(e) => setWidthIn(e.target.value)}
        aria-label="Width inches"
      />
      ×
      <input
        style={{ width: "4rem" }}
        value={heightIn}
        onChange={(e) => setHeightIn(e.target.value)}
        aria-label="Height inches"
      />
      in, sill
      <input
        style={{ width: "4rem" }}
        value={sillIn}
        onChange={(e) => setSillIn(e.target.value)}
        aria-label="Sill inches"
      />
      in
      <button
        onClick={() => {
          const w = Number(widthIn);
          const h = Number(heightIn);
          const s = Number(sillIn);
          if (!(w > 0) || !(h > 0)) return;
          const wall = draft.walls.find((x) => x.id === wallId);
          const roomIds = wall ? [wall.roomId] : draft.rooms.length > 0 ? [draft.rooms[0]!.id] : [];
          if (roomIds.length === 0) return;
          onAdd({
            openingType: type,
            wallId: wallId || null,
            roomIds,
            widthM: inchesToMeters(w),
            heightM: inchesToMeters(h),
            sillHeightM: type === "window" && s >= 0 ? inchesToMeters(s) : null
          });
        }}
      >
        Add
      </button>
    </div>
  );
}

interface ScheduleEntry {
  key: string;
  rooms: string[];
  widthDisplay: string | null;
  heightDisplay: string | null;
  sillHeightDisplay: string | null;
  confidence: string;
  verification: string;
}

function Schedules({
  planId,
  organizationId,
  revisionId
}: {
  planId: string;
  organizationId: string;
  revisionId: string;
}) {
  const [windows, setWindows] = useState<ScheduleEntry[]>([]);
  const [doors, setDoors] = useState<ScheduleEntry[]>([]);
  const [disclaimer, setDisclaimer] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const w = await api<{ data: ScheduleEntry[]; disclaimer: string }>(
          `/v1/plans/${planId}/schedules/windows`,
          { organizationId }
        );
        setWindows(w.data);
        setDisclaimer(w.disclaimer);
        const d = await api<{ data: ScheduleEntry[] }>(`/v1/plans/${planId}/schedules/doors`, {
          organizationId
        });
        setDoors(d.data);
      } catch {
        // schedules unavailable until a revision exists
      }
    })();
  }, [planId, organizationId, revisionId]);

  const table = (title: string, entries: ScheduleEntry[]) => (
    <Card title={title}>
      {entries.length === 0 ? (
        <p>None.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
          <thead>
            <tr>
              {["Key", "Room", "Width", "Height", "Sill", "Confidence", "Verification"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "0.3rem",
                    borderBottom: "1px solid #dde2e8"
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.key} style={{ borderBottom: "1px solid #eef1f5" }}>
                <td style={{ padding: "0.3rem" }}>{e.key}</td>
                <td style={{ padding: "0.3rem" }}>{e.rooms.join(", ")}</td>
                <td style={{ padding: "0.3rem" }}>{e.widthDisplay ?? "—"}</td>
                <td style={{ padding: "0.3rem" }}>{e.heightDisplay ?? "—"}</td>
                <td style={{ padding: "0.3rem" }}>{e.sillHeightDisplay ?? "—"}</td>
                <td style={{ padding: "0.3rem" }}>{e.confidence}</td>
                <td style={{ padding: "0.3rem" }}>{e.verification}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  return (
    <>
      {table("Window schedule", windows)}
      {table("Door schedule", doors)}
      {disclaimer ? <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>{disclaimer}</p> : null}
    </>
  );
}
