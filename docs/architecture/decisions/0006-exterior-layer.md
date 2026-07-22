# ADR 0006 — Exterior layer: documentation-first facades, no fake exterior capture

Date: 2026-07-22 · Status: accepted

## Context

The product spec covers interior capture (RoomPlan is interior-only). StudioKL
estimating also needs the exterior of a property: facades, exterior-side
window/door dimensions, siding context, photos. There is no reliable automatic
exterior reconstruction on the target devices, and guardrail §20 forbids
shipping abstractions that claim unsupported hardware capabilities.

## Decision

V1 exterior is **structured documentation, not automatic capture**:

- `facades`: labeled exterior elevation faces per property (label unique per
  property, optional compass orientation for display).
- `facade_openings`: windows/doors/garage doors/vents/other documented from the
  outside, dimensions in canonical meters, optional link to the interior plan
  opening (`linked_interior_opening_id`, unenforced across revisions).
- Measurements reuse the generic `measurements` table with full provenance
  (spec §7.4). `POST /v1/measurements` records manual/laser entries;
  `field_verified` requires an identified user, timestamp, and manual/laser
  source, and only then denormalizes onto the facade opening's displayed
  dimension. History is append-only.
- Media attach to `facade` / `facade_opening` subjects through `media_links`.

Future exterior reconstruction (photogrammetry/object capture) would plug in as
a new capture adapter feeding the same records; nothing in the schema assumes
manual entry forever.

## Consequences

Exterior data is honest about its source and verification state from day one.
Field crews get value immediately (photos + laser-verified dimensions in the
same tenancy/provenance model), and no false capability is implied. iOS
exterior photo capture UX and the web facade panel are follow-ups tracked in
docs/STATUS.md.
