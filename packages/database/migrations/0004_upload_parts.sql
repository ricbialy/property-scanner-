-- Phase 2: resumable chunked capture uploads. A capture artifact may be
-- uploaded as N parts; each received part is recorded so an interrupted client
-- can query state and resume with only the missing parts. Completion assembles
-- and checksum-verifies the whole bundle.

alter table capture_artifacts
  add column part_count integer not null default 1 check (part_count >= 1 and part_count <= 10000);

create table capture_upload_parts (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  capture_artifact_id uuid not null references capture_artifacts (id),
  part_number integer not null check (part_number >= 1),
  byte_size bigint not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (capture_artifact_id, part_number)
);
create index capture_upload_parts_artifact_idx on capture_upload_parts (capture_artifact_id);
