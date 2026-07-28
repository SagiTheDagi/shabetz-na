import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import type { JusticeChartEntry, JusticeChartData } from "@/lib/types";

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

function buildChartData(db: ReturnType<typeof import("@/lib/db").getDb>): JusticeChartData {
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

export async function GET() {
  const db = getDb();
  return NextResponse.json(buildChartData(db));
}

export async function POST() {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const db = getDb();

  const now = new Date();
  const periodEnd = now.toISOString().split("T")[0];
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const periodStart = yearAgo.toISOString().split("T")[0];

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

  db.prepare("DELETE FROM JusticeChart").run();

  const insert = db.prepare(
    `INSERT INTO JusticeChart (worker_id, shift_type_id, total_shifts, weekend_shifts, period_start, period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  db.transaction(() => {
    for (const row of counts) {
      insert.run(row.worker_id, row.shift_type_id, row.total_shifts, row.weekend_shifts, periodStart, periodEnd);
    }
  })();

  return NextResponse.json(buildChartData(db));
}
