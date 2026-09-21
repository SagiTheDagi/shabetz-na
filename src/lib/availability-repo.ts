/**
 * Write path for WorkerAvailability.
 *
 * Shared by `POST /api/availability` (one worker) and
 * `POST /api/availability/bulk` (many workers, form import).
 *
 * The invariant this module exists to protect: a replace is scoped to a single
 * `source`, so each channel only clears rows it created. A worker saving their
 * calendar must never wipe admin-imported constraints, and re-running an import
 * must never wipe what the worker entered themselves.
 */

import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import {
  AVAILABILITY_STATUSES,
  type AvailabilitySource,
  type AvailabilityStatus,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AvailabilityEntry {
  date: string;
  status: AvailabilityStatus;
  note?: string | null;
}

export interface ReplaceArgs {
  workerId: string;
  quarterId: string;
  source: AvailabilitySource;
  entries: AvailabilityEntry[];
}

/**
 * Returns a Hebrew error message, or null when the batch is valid.
 * Callers validate everything before writing so a bad row cannot leave a
 * half-applied import behind.
 */
export function validateEntries(entries: AvailabilityEntry[], label = ""): string | null {
  const prefix = label ? `${label}: ` : "";
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry || !ISO_DATE.test(entry.date)) {
      return `${prefix}תאריך לא תקין — ${entry?.date}`;
    }
    if (!AVAILABILITY_STATUSES.includes(entry.status)) {
      return `${prefix}סטטוס לא תקין — ${entry.status}`;
    }
    if (seen.has(entry.date)) {
      return `${prefix}תאריך כפול — ${entry.date}`;
    }
    seen.add(entry.date);
  }

  return null;
}

/**
 * Replaces one worker's rows for one quarter, for one source.
 *
 * Must be called inside a transaction when writing several workers at once.
 *
 * Note on collisions: `UNIQUE(worker_id, quarter_id, date)` permits only one
 * row per date regardless of source, so writing a date that another source
 * already owns takes it over (last write wins). The `source` and `note` columns
 * keep that visible after the fact.
 */
export function replaceAvailability(db: Database, args: ReplaceArgs): number {
  const { workerId, quarterId, source, entries } = args;

  db.prepare(
    "DELETE FROM WorkerAvailability WHERE worker_id = ? AND quarter_id = ? AND source = ?"
  ).run(workerId, quarterId, source);

  const insert = db.prepare(
    `INSERT INTO WorkerAvailability (availability_id, worker_id, quarter_id, date, status, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(worker_id, quarter_id, date) DO UPDATE SET
       status = excluded.status,
       source = excluded.source,
       note   = excluded.note`
  );

  for (const entry of entries) {
    insert.run(uuid(), workerId, quarterId, entry.date, entry.status, source, entry.note ?? null);
  }

  return entries.length;
}

/** All rows for a worker in a quarter, ordered by date. */
export function readAvailability(db: Database, workerId: string, quarterId: string) {
  return db
    .prepare(
      "SELECT * FROM WorkerAvailability WHERE worker_id = ? AND quarter_id = ? ORDER BY date"
    )
    .all(workerId, quarterId);
}
