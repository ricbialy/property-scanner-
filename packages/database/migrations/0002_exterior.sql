-- Exterior layer: facades (exterior elevation faces of a property) and
-- facade openings documented from the outside. Exterior capture in V1 is
-- structured manual/laser measurement + photo documentation — there is no
-- automatic exterior reconstruction (RoomPlan is interior-only). Measurements
-- reuse the generic measurements table via subject_type/subject_id.

create table facades (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  property_id uuid not null references properties (id),
  label text not null, -- e.g. 'Front', 'North', 'Garage side'
  orientation_deg double precision, -- compass bearing for display; nullable
  notes text,
  created_at timestamptz not null default now(),
  unique (property_id, label)
);
create index facades_org_idx on facades (organization_id);

create table facade_openings (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  facade_id uuid not null references facades (id),
  opening_type text not null check (
    opening_type in ('window', 'door', 'garage_door', 'vent', 'other')
  ),
  label text,
  width_m double precision,
  height_m double precision,
  sill_height_m double precision,
  -- Optional link to the same physical opening seen from inside (plan payload
  -- opening id). Nullable and unenforced across revisions by design.
  linked_interior_opening_id uuid,
  confidence text not null default 'unknown' check (confidence in ('high', 'medium', 'low', 'unknown')),
  verification text not null default 'unverified' check (
    verification in ('unverified', 'reviewed', 'field_verified', 'rejected')
  ),
  created_at timestamptz not null default now()
);
create index facade_openings_facade_idx on facade_openings (facade_id);
create index facade_openings_org_idx on facade_openings (organization_id);

-- Media can now attach to facades and facade openings as well.
alter table media_links drop constraint media_links_subject_type_check;
alter table media_links add constraint media_links_subject_type_check
  check (subject_type in ('room', 'opening', 'annotation', 'facade', 'facade_opening'));
