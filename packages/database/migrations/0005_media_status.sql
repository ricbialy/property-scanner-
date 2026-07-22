-- Media pipeline: media rows need an upload lifecycle. 'pending' until bytes
-- are stored and verified; 'ready' after MIME/checksum validation and metadata
-- policy application; 'rejected' when validation fails.

alter table media
  add column status text not null default 'pending'
  check (status in ('pending', 'ready', 'rejected'));
