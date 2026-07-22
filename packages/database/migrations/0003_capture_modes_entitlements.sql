-- Exterior amendment (docs/PROPERTY_SCAN_EXTERIOR_FACADE_AMENDMENT.md §19.1):
-- bounded, backward-compatible changes only.
--
-- 1. Capture-mode discriminator on scan sessions. Existing records are
--    explicitly interior_roomplan.
-- 2. Tenant-aware entitlements, enforced server-side. Exterior capture and all
--    dependent automation stay disabled until their acceptance gates pass.

alter table scan_sessions
  add column capture_mode text not null default 'interior_roomplan'
  check (capture_mode in ('interior_roomplan', 'exterior_facade', 'opening_verification'));

-- Explicit mapping of pre-existing records (the default already covers new rows).
update scan_sessions set capture_mode = 'interior_roomplan' where capture_mode is null;

create table entitlements (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  entitlement_key text not null check (
    entitlement_key in (
      'interior_capture',
      'exterior_capture',
      'opening_verification',
      'facade_auto_detection',
      'photogrammetry_processing',
      'advanced_exports',
      'api_access'
    )
  ),
  enabled boolean not null default false,
  granted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entitlement_key)
);
create index entitlements_org_idx on entitlements (organization_id);
