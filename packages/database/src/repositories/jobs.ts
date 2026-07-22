import { uuidv7 } from "../ids.js";
import type { Queryable } from "../pool.js";

export interface JobRow {
  id: string;
  job_key: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
}

/** Enqueue a job. Idempotent on job_key — duplicates return the existing job. */
export async function enqueueJob(
  db: Queryable,
  input: { jobKey: string; jobType: string; payload: Record<string, unknown> }
): Promise<JobRow> {
  const { rows } = await db.query(
    `insert into jobs (id, job_key, job_type, payload)
     values ($1, $2, $3, $4)
     on conflict (job_key) do update set updated_at = now()
     returning *`,
    [uuidv7(), input.jobKey, input.jobType, JSON.stringify(input.payload)]
  );
  return rows[0] as JobRow;
}

/** Claim the next runnable job with SKIP LOCKED so concurrent workers never collide. */
export async function claimNextJob(db: Queryable, workerId: string): Promise<JobRow | null> {
  const { rows } = await db.query(
    `update jobs set status = 'running', attempts = attempts + 1,
            locked_at = now(), locked_by = $1, updated_at = now()
     where id = (
       select id from jobs
       where status = 'queued' and run_at <= now()
       order by run_at
       for update skip locked
       limit 1
     )
     returning *`,
    [workerId]
  );
  return (rows[0] as JobRow | undefined) ?? null;
}

export async function completeJob(db: Queryable, jobId: string): Promise<void> {
  await db.query(
    "update jobs set status = 'succeeded', locked_at = null, locked_by = null, updated_at = now() where id = $1",
    [jobId]
  );
}

/** Retry with exponential backoff; jobs exceeding max_attempts go to dead-letter. */
export async function failJob(db: Queryable, job: JobRow, error: string): Promise<void> {
  if (job.attempts >= job.max_attempts) {
    await db.query(
      "update jobs set status = 'dead', last_error = $1, locked_at = null, locked_by = null, updated_at = now() where id = $2",
      [error, job.id]
    );
    return;
  }
  const backoffSeconds = Math.min(2 ** job.attempts * 5, 600);
  await db.query(
    `update jobs set status = 'queued', last_error = $1,
            run_at = now() + make_interval(secs => $2),
            locked_at = null, locked_by = null, updated_at = now()
     where id = $3`,
    [error, backoffSeconds, job.id]
  );
}
