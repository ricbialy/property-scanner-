import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface MediaRow {
  id: string;
  organization_id: string;
  object_key: string;
  mime_type: string;
  byte_size: string | number | null;
  sha256: string | null;
  width_px: number | null;
  height_px: number | null;
  captured_at: Date | null;
  exif_policy: string;
  thumbnail_status: "pending" | "ready" | "failed";
  status: "pending" | "ready" | "rejected";
  created_at: Date;
}

export interface MediaLinkRow {
  id: string;
  media_id: string;
  subject_type: string;
  subject_id: string;
  position: number;
}

export async function createMediaUpload(
  db: Queryable,
  organizationId: string,
  input: { objectKey: string; mimeType: string; capturedAt?: Date }
): Promise<MediaRow> {
  const { rows } = await db.query(
    `insert into media (id, organization_id, object_key, mime_type, captured_at)
     values ($1, $2, $3, $4, $5) returning *`,
    [uuidv7(), organizationId, input.objectKey, input.mimeType, input.capturedAt ?? null]
  );
  return rows[0] as MediaRow;
}

export async function findMediaById(
  db: Queryable,
  organizationId: string,
  mediaId: string
): Promise<MediaRow | null> {
  const { rows } = await db.query("select * from media where id = $1 and organization_id = $2", [
    mediaId,
    organizationId
  ]);
  return (rows[0] as MediaRow | undefined) ?? null;
}

export async function markMediaReady(
  db: Queryable,
  organizationId: string,
  mediaId: string,
  input: {
    sha256: string;
    byteSize: number;
    widthPx: number | null;
    heightPx: number | null;
    exifPolicy: string;
  }
): Promise<MediaRow | null> {
  const { rows } = await db.query(
    `update media
     set status = 'ready', sha256 = $1, byte_size = $2, width_px = $3, height_px = $4, exif_policy = $5
     where id = $6 and organization_id = $7
     returning *`,
    [
      input.sha256,
      input.byteSize,
      input.widthPx,
      input.heightPx,
      input.exifPolicy,
      mediaId,
      organizationId
    ]
  );
  return (rows[0] as MediaRow | undefined) ?? null;
}

export async function markMediaRejected(
  db: Queryable,
  organizationId: string,
  mediaId: string
): Promise<void> {
  await db.query("update media set status = 'rejected' where id = $1 and organization_id = $2", [
    mediaId,
    organizationId
  ]);
}

/** Link media to a subject; re-linking the same pair updates position only. */
export async function createMediaLink(
  db: Queryable,
  organizationId: string,
  input: { mediaId: string; subjectType: string; subjectId: string; position: number }
): Promise<MediaLinkRow> {
  const { rows } = await db.query(
    `insert into media_links (id, organization_id, media_id, subject_type, subject_id, position)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (media_id, subject_type, subject_id) do update set position = $6
     returning *`,
    [uuidv7(), organizationId, input.mediaId, input.subjectType, input.subjectId, input.position]
  );
  return rows[0] as MediaLinkRow;
}

export async function listMediaForSubject(
  db: Queryable,
  organizationId: string,
  subjectType: string,
  subjectId: string
): Promise<Array<MediaRow & { position: number }>> {
  const { rows } = await db.query(
    `select m.*, l.position from media_links l
     join media m on m.id = l.media_id
     where l.organization_id = $1 and l.subject_type = $2 and l.subject_id = $3
     order by l.position, m.id`,
    [organizationId, subjectType, subjectId]
  );
  return rows as Array<MediaRow & { position: number }>;
}
