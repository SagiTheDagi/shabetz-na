/**
 * Justice chart: per-worker shift counts over the trailing year.
 *
 * DB-backed functions take the connection as a parameter so they can be tested
 * against an in-memory database. `filterJusticeEntries` is pure.
 */

import type { Database } from "better-sqlite3";
import { toIsoDate } from "./date-utils";
import type { JusticeChartData, JusticeChartEntry } from "./types";

type RawRow = {
  worker_id: string;
  name: string;
  rank_name: string;
  shift_type_id: string;
  total_shifts: number;
  weekend_shifts: number;
  period_start: string;
  period_end: string;
  updated_at: string;
};

/** Trailing one-year window ending today, as local calendar dates. */
export function getJusticePeriod(now: Date = new Date()): { periodStart: string; periodEnd: string } {
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  return { periodStart: toIsoDate(yearAgo), periodEnd: toIsoDate(now) };
}

/** Read the stored chart, one entry per worker, sorted by total desc then name. */
export function buildChartData(db: Database): JusticeChartData {
  const shiftTypes = db
    .prepare("SELECT shift_type_id, name FROM ShiftType ORDER BY display_order ASC")
    .all() as { shift_type_id: string; name: string }[];

  const rows = db
    .prepare(
      `SELECT jc.worker_id, w.name, r.name AS rank_name,
              jc.shift_type_id, jc.total_shifts, jc.weekend_shifts,
              jc.period_start, jc.period_end, jc.updated_at
       FROM JusticeChart jc
       JOIN Worker w ON w.worker_id = jc.worker_id
       JOIN Rank r ON r.rank_id = w.rank_id
       ORDER BY jc.worker_id`
    )
    .all() as RawRow[];

  const workerMap = new Map<string, JusticeChartEntry>();
  for (const row of rows) {
    if (!workerMap.has(row.worker_id)) {
      workerMap.set(row.worker_id, {
        worker_id: row.worker_id,
        name: row.name,
        rank_name: row.rank_name,
        total_shifts: 0,
        weekend_shifts: 0,
        shift_counts: {},
        period_start: row.period_start,
        period_end: row.period_end,
        updated_at: row.updated_at,
      });
    }
    const entry = workerMap.get(row.worker_id)!;
    entry.shift_counts[row.shift_type_id] = row.total_shifts;
    entry.total_shifts += row.total_shifts;
    entry.weekend_shifts += row.weekend_shifts;
  }

  const entries = Array.from(workerMap.values()).sort(
    (a, b) => b.total_shifts - a.total_shifts || a.name.localeCompare(b.name, "he")
  );

  return { shift_types: shiftTypes, entries };
}

/**
 * Recompute the chart from ShiftHistory for the trailing year and store it.
 * Only active, non-exempt workers that receive shift allocation are included;
 * each gets a row for every shift type (zero if none).
 */
export function recomputeJusticeChart(db: Database, now: Date = new Date()): JusticeChartData {
  const { periodStart, periodEnd } = getJusticePeriod(now);

  const counts = db
    .prepare(
      `SELECT w.worker_id, st.shift_type_id, COUNT(sh.history_id) AS total_shifts,
              COALESCE(SUM(sh.was_weekend), 0) AS weekend_shifts
       FROM Worker w
       CROSS JOIN ShiftType st
       LEFT JOIN (
         SELECT sh2.worker_id, sh2.history_id, sh2.was_weekend, sd.shift_type_id
         FROM ShiftHistory sh2
         JOIN ShiftDate sd ON sd.shift_date_id = sh2.shift_date_id
         WHERE sd.date >= ? AND sd.date <= ?
       ) sh ON sh.worker_id = w.worker_id AND sh.shift_type_id = st.shift_type_id
       WHERE w.is_archived = 0 AND w.receives_shift_allocation = 1 AND w.is_exempt = 0
       GROUP BY w.worker_id, st.shift_type_id`
    )
    .all(periodStart, periodEnd) as {
    worker_id: string;
    shift_type_id: string;
    total_shifts: number;
    weekend_shifts: number;
  }[];

  const insert = db.prepare(
    `INSERT INTO JusticeChart (worker_id, shift_type_id, total_shifts, weekend_shifts, period_start, period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  db.transaction(() => {
    db.prepare("DELETE FROM JusticeChart").run();
    for (const row of counts) {
      insert.run(row.worker_id, row.shift_type_id, row.total_shifts, row.weekend_shifts, periodStart, periodEnd);
    }
  })();

  return buildChartData(db);
}

export interface JusticeFilters {
  name?: string;
  ranks?: string[];
  minTotal?: number;
}

/** Name (case-insensitive substring), rank (any-of) and minimum-total filters, ANDed. */
export function filterJusticeEntries(
  entries: JusticeChartEntry[],
  { name = "", ranks = [], minTotal = 0 }: JusticeFilters
): JusticeChartEntry[] {
  const nameLower = name.trim().toLowerCase();
  return entries.filter((e) => {
    if (nameLower && !e.name.toLowerCase().includes(nameLower)) return false;
    if (ranks.length > 0 && !ranks.includes(e.rank_name)) return false;
    if (e.total_shifts < minTotal) return false;
    return true;
  });
}
