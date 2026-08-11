import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Returns every active (non-archived) worker together with how many shifts and
// weekend shifts they were assigned in the given quarter. Shift counts come from
// ShiftHistory, which is written only for role='shift' assignments (not reserves).
export async function GET(req: NextRequest) {
  const quarterId = req.nextUrl.searchParams.get("quarter_id");
  if (!quarterId) {
    return NextResponse.json({ error: "חסר מזהה רבעון" }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT w.worker_id, w.name, COALESCE(r.name, '') AS rank_name, w.branch, w.team,
              w.is_exempt, w.exemption_reason,
              COALESCE(h.shifts, 0) AS shifts,
              COALESCE(h.weekends, 0) AS weekends
       FROM Worker w
       LEFT JOIN Rank r ON r.rank_id = w.rank_id
       LEFT JOIN (
         SELECT worker_id, COUNT(*) AS shifts, COALESCE(SUM(was_weekend), 0) AS weekends
         FROM ShiftHistory
         WHERE quarter_id = ?
         GROUP BY worker_id
       ) h ON h.worker_id = w.worker_id
       WHERE w.is_archived = 0
       ORDER BY r.display_order, w.name`
    )
    .all(quarterId);

  return NextResponse.json(rows);
}
