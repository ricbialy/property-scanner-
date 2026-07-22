-- Property Scan initial schema.
-- Conventions: snake_case, uuid primary keys (UUIDv7 generated in the application),
-- timestamptz in UTC, tenant-owned tables carry organization_id.

create table organizations (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  user_id text not null, -- identity-provider (Clerk) user id
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

create table properties (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  external_references jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index properties_org_idx on properties (organization_id);

create table floors (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  property_id uuid not null references properties (id),
  name text not null,
  ordinal integer not null default 0,
  elevation_m double precision,
  display_units text not null default 'imperial' check (display_units in ('metric', 'imperial')),
  created_at timestamptz not null default now(),
  unique (property_id, ordinal)
);
create index floors_org_idx on floors (organization_id);

create table plans (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  floor_id uuid not null references floors (id),
  scan_session_id uuid,
  current_revision_id uuid,
  created_at timestamptz not null default now()
);
create index plans_org_idx on plans (organization_id);

create table scan_sessions (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  property_id uuid not null references properties (id),
  floor_id uuid not null references floors (id),
  status text not null default 'draft' check (
    status in ('draft', 'capturing', 'local_review', 'queued_upload', 'uploading',
               'processing', 'needs_review', 'failed', 'completed')
  ),
  requested_outputs jsonb not null default '["normalized_json"]'::jsonb,
  external_references jsonb not null default '[]'::jsonb,
  assigned_user_id text,
  plan_id uuid references plans (id),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scan_sessions_org_idx on scan_sessions (organization_id);

create table scan_handoff_tokens (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  scan_session_id uuid not null references scan_sessions (id),
  token_hash text not null unique, -- SHA-256 hex; raw token is never stored
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index scan_handoff_tokens_session_idx on scan_handoff_tokens (scan_session_id);

create table capture_artifacts (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  scan_session_id uuid not null references scan_sessions (id),
  capture_id uuid not null, -- client-generated; makes upload idempotent
  object_key text not null,
  byte_size bigint,
  sha256 text,
  content_type text not null,
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scan_session_id, capture_id)
);

create table import_runs (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  scan_session_id uuid not null references scan_sessions (id),
  capture_artifact_id uuid not null references capture_artifacts (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  findings jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index import_runs_session_idx on import_runs (scan_session_id);

create table plan_revisions (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  plan_id uuid not null references plans (id),
  parent_revision_id uuid references plan_revisions (id),
  author_type text not null check (author_type in ('import', 'user', 'system')),
  reason text not null,
  status text not null default 'draft' check (status in ('draft', 'accepted', 'superseded')),
  version integer not null,
  geometry_schema_version text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);
create index plan_revisions_plan_idx on plan_revisions (plan_id);

alter table plans
  add constraint plans_current_revision_fk
  foreign key (current_revision_id) references plan_revisions (id);

create table rooms (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  plan_revision_id uuid not null references plan_revisions (id),
  source_room_id uuid,
  name text,
  boundary jsonb, -- CCW polygon [{x,y}] in meters; null until normalized
  area_m2 double precision,
  confidence text not null default 'unknown' check (confidence in ('high', 'medium', 'low', 'unknown')),
  created_at timestamptz not null default now()
);
create index rooms_revision_idx on rooms (plan_revision_id);

create table walls (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  plan_revision_id uuid not null references plan_revisions (id),
  room_id uuid references rooms (id),
  start_x double precision,
  start_y double precision,
  end_x double precision,
  end_y double precision,
  thickness_m double precision,
  height_m double precision,
  source text not null default 'roomplan' check (source in ('roomplan', 'manual', 'laser', 'derived')),
  confidence text not null default 'unknown' check (confidence in ('high', 'medium', 'low', 'unknown')),
  source_metadata jsonb,
  created_at timestamptz not null default now()
);
create index walls_revision_idx on walls (plan_revision_id);

create table openings (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  plan_revision_id uuid not null references plan_revisions (id),
  wall_id uuid references walls (id),
  opening_type text not null default 'unknown' check (opening_type in ('window', 'door', 'open_passage', 'unknown')),
  offset_along_wall_m double precision,
  width_m double precision,
  height_m double precision,
  sill_height_m double precision,
  room_ids jsonb not null default '[]'::jsonb,
  confidence text not null default 'unknown' check (confidence in ('high', 'medium', 'low', 'unknown')),
  verification text not null default 'unverified' check (verification in ('unverified', 'reviewed', 'field_verified', 'rejected')),
  source_metadata jsonb,
  created_at timestamptz not null default now()
);
create index openings_revision_idx on openings (plan_revision_id);

create table measurements (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  plan_revision_id uuid references plan_revisions (id),
  subject_type text not null,
  subject_id uuid not null,
  value double precision not null,
  unit text not null default 'm',
  semantic_type text not null,
  source text not null check (source in ('roomplan', 'manual', 'laser', 'derived')),
  captured_by text,
  captured_at timestamptz,
  uncertainty_m double precision,
  verification text not null default 'unverified' check (verification in ('unverified', 'reviewed', 'field_verified', 'rejected')),
  supersedes_id uuid references measurements (id),
  notes text,
  created_at timestamptz not null default now()
);
create index measurements_subject_idx on measurements (subject_type, subject_id);

create table annotations (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  plan_revision_id uuid not null references plan_revisions (id),
  subject_type text,
  subject_id uuid,
  body text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table media (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  object_key text not null,
  mime_type text not null,
  byte_size bigint,
  sha256 text,
  width_px integer,
  height_px integer,
  captured_at timestamptz,
  exif_policy text not null default 'strip_gps',
  thumbnail_status text not null default 'pending' check (thumbnail_status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table media_links (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  media_id uuid not null references media (id),
  subject_type text not null check (subject_type in ('room', 'opening', 'annotation')),
  subject_id uuid not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (media_id, subject_type, subject_id)
);

create table exports (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  plan_revision_id uuid not null references plan_revisions (id),
  format text not null check (format in ('normalized_json', 'svg', 'pdf')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  object_key text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key,
  job_key text not null unique, -- idempotency key for the job itself
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_poll_idx on jobs (status, run_at);

create table outbox_events (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  event_type text not null,
  resource_type text not null,
  resource_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);
create index outbox_undispatched_idx on outbox_events (dispatched_at) where dispatched_at is null;

create table integration_connections (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  system text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table service_credentials (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  name text not null,
  token_hash text not null unique,
  scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);

create table webhook_endpoints (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  url text not null,
  secret_encrypted text not null,
  secret_key_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  webhook_endpoint_id uuid not null references webhook_endpoints (id),
  outbox_event_id uuid not null references outbox_events (id),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  actor_type text not null check (actor_type in ('user', 'service', 'system')),
  actor_id text,
  action text not null,
  subject_type text not null,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_org_idx on audit_events (organization_id, created_at);

create table idempotency_keys (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  idempotency_key text not null,
  endpoint text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, endpoint, idempotency_key)
);
