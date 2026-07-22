import {
  NOT_PROCESSED,
  type PlanCommand,
  type PlanRevisionPayload,
  type ValidationFinding
} from "@propertyscan/contracts";
import { uuidv7 } from "@propertyscan/database";

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly commandIndex: number
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export interface AppliedCommands {
  payload: PlanRevisionPayload;
  /** Measurements to record with provenance for verifyOpening commands. */
  verifications: Array<{
    openingId: string;
    source: "manual" | "laser";
    values: Array<{ semanticType: "width" | "height" | "sill_height"; valueM: number }>;
  }>;
}

/**
 * Reduce typed correction commands into a new revision payload (spec §10.2).
 * The parent payload is never mutated; every command is validated against the
 * evolving state so a stale reference fails loudly instead of corrupting
 * geometry. Openings left without a host wall carry an explicit
 * opening_unattached finding rather than being silently detached.
 */
export function applyCommands(
  parent: PlanRevisionPayload,
  commands: PlanCommand[],
  ids: { planId: string; revisionId: string }
): AppliedCommands {
  const payload: PlanRevisionPayload = structuredClone(parent);
  payload.planId = ids.planId;
  payload.revisionId = ids.revisionId;
  const verifications: AppliedCommands["verifications"] = [];

  const roomById = () => new Map(payload.rooms.map((r) => [r.id, r]));
  const openingIndexById = () => new Map(payload.openings.map((o, i) => [o.id, i]));
  const wallIds = new Set(payload.walls.map((w) => w.id));

  commands.forEach((command, index) => {
    switch (command.type) {
      case "renameRoom": {
        const room = roomById().get(command.roomId);
        if (!room) throw new CommandError(`room ${command.roomId} not found`, index);
        room.name = command.name;
        break;
      }
      case "updateOpening": {
        const i = openingIndexById().get(command.openingId);
        if (i === undefined)
          throw new CommandError(`opening ${command.openingId} not found`, index);
        const opening = payload.openings[i]!;
        const patch = command.patch;
        if (patch.wallId !== undefined && patch.wallId !== null && !wallIds.has(patch.wallId)) {
          throw new CommandError(`wall ${patch.wallId} not found`, index);
        }
        if (patch.openingType !== undefined) opening.type = patch.openingType;
        if (patch.widthM !== undefined) opening.widthM = patch.widthM;
        if (patch.heightM !== undefined) opening.heightM = patch.heightM;
        if (patch.sillHeightM !== undefined) opening.sillHeightM = patch.sillHeightM;
        if (patch.wallId !== undefined) opening.wallId = patch.wallId;
        if (patch.offsetAlongWallM !== undefined) opening.offsetAlongWallM = patch.offsetAlongWallM;
        break;
      }
      case "addOpening": {
        const input = command.opening;
        if (input.wallId !== null && !wallIds.has(input.wallId)) {
          throw new CommandError(`wall ${input.wallId} not found`, index);
        }
        const rooms = roomById();
        for (const roomId of input.roomIds) {
          if (!rooms.has(roomId)) throw new CommandError(`room ${roomId} not found`, index);
        }
        payload.openings.push({
          id: uuidv7(),
          sourceId: null,
          type: input.openingType,
          wallId: input.wallId,
          offsetAlongWallM: input.offsetAlongWallM ?? NOT_PROCESSED,
          widthM: input.widthM,
          heightM: input.heightM,
          sillHeightM: input.sillHeightM,
          roomIds: input.roomIds,
          confidence: "unknown",
          verification: "unverified"
        });
        break;
      }
      case "removeOpening": {
        const i = openingIndexById().get(command.openingId);
        if (i === undefined)
          throw new CommandError(`opening ${command.openingId} not found`, index);
        payload.openings.splice(i, 1);
        break;
      }
      case "verifyOpening": {
        const i = openingIndexById().get(command.openingId);
        if (i === undefined)
          throw new CommandError(`opening ${command.openingId} not found`, index);
        const opening = payload.openings[i]!;
        const values: Array<{ semanticType: "width" | "height" | "sill_height"; valueM: number }> =
          [];
        if (command.widthM !== undefined) {
          opening.widthM = command.widthM;
          values.push({ semanticType: "width", valueM: command.widthM });
        }
        if (command.heightM !== undefined) {
          opening.heightM = command.heightM;
          values.push({ semanticType: "height", valueM: command.heightM });
        }
        if (command.sillHeightM !== undefined) {
          opening.sillHeightM = command.sillHeightM;
          values.push({ semanticType: "sill_height", valueM: command.sillHeightM });
        }
        if (values.length === 0) {
          throw new CommandError("verifyOpening requires at least one dimension", index);
        }
        opening.verification = "field_verified";
        verifications.push({ openingId: opening.id, source: command.source, values });
        break;
      }
    }
  });

  // Recompute unattached-opening findings for the new payload state.
  const keepFindings: ValidationFinding[] = payload.validationFindings.filter(
    (f) => f.code !== "opening_unattached"
  );
  for (const opening of payload.openings) {
    if (opening.wallId === null) {
      keepFindings.push({
        code: "opening_unattached",
        severity: "warning",
        message: `${opening.type} ${opening.id} has no host wall; reattach or confirm as unresolved`,
        subjectType: "opening",
        subjectId: opening.id
      });
    }
  }
  payload.validationFindings = keepFindings;

  return { payload, verifications };
}
