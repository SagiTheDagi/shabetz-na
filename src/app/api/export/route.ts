import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { ExportData } from "@/lib/types";

export async function GET(req: NextRequest) {
  const quarterId = req.nextUrl.searchParams.get("quarter_id");
  if (!quarterId) {
    return NextResponse.json({ error: "נדרש מזהה רבעון" }, { status: 400 });
  }

  const db = getDb();

  const quarter = db.prepare("SELECT * FROM Quarter WHERE quarter_id = ?").get(quarterId);
  if (!quarter) {
    return NextResponse.json({ error: "רבעון לא נמצא" }, { status: 404 });
  }

  const ranks = db.prepare("SELECT rank_id, name, display_order FROM Rank ORDER BY display_order").all();
  const shift_types = db.prepare("SELECT shift_type_id, name, display_order FROM ShiftType ORDER BY display_order").all();
  const eligibility = db.prepare("SELECT rank_id, shift_type_id, priority FROM RankShiftEligibility").all();

  const shift_dates = db
    .prepare("SELECT shift_date_id, date, shift_type_id, is_weekend FROM ShiftDate WHERE quarter_id = ? ORDER BY date")
    .all(quarterId);

  const assignments = db
    .prepare(
      `SELECT sa.shift_date_id, sa.worker_id, sa.is_forced, sa.force_reason, sa.assigned_at, sa.role
       FROM ShiftAssignment sa
       JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id
       WHERE sd.quarter_id = ?`
    )
    .all(quarterId);

  const worker_availability = db
    .prepare(
      "SELECT worker_id, date, status FROM WorkerAvailability WHERE quarter_id = ? ORDER BY worker_id, date"
    )
    .all(quarterId);

  const exportData: ExportData = {
    version: 3,
    exported_at: new Date().toISOString(),
    ranks: ranks as ExportData["ranks"],
    shift_types: shift_types as ExportData["shift_types"],
    eligibility: eligibility as ExportData["eligibility"],
    quarter: quarter as ExportData["quarter"],
    shift_dates: shift_dates as ExportData["shift_dates"],
    assignments: (assignments as { shift_date_id: string; worker_id: string; is_forced: number; force_reason: string | null; assigned_at: string; role: "shift" | "reserve" }[]).map((a) => ({
      ...a,
      is_forced: !!a.is_forced,
      role: a.role ?? "shift",
    })),
    worker_availability: worker_availability as ExportData["worker_availability"],
  };

  return NextResponse.json(exportData);
}

export async function POST(req: Request) {
  const data = (await req.json()) as ExportData;

  if (!data.version || !data.quarter) {
    return NextResponse.json({ error: "קובץ ייבוא לא תקין" }, { status: 400 });
  }

  const db = getDb();

  const importAll = db.transaction(() => {
    const q = data.quarter;

    db.prepare(
      `INSERT OR REPLACE INTO Quarter (quarter_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?)`
    ).run(q.quarter_id, q.start_date, q.end_date, q.status);

    db.prepare(
      "DELETE FROM ShiftAssignment WHERE shift_date_id IN (SELECT shift_date_id FROM ShiftDate WHERE quarter_id = ?)"
    ).run(q.quarter_id);
    db.prepare("DELETE FROM ShiftDate WHERE quarter_id = ?").run(q.quarter_id);
    db.prepare("DELETE FROM WorkerAvailability WHERE quarter_id = ?").run(q.quarter_id);

    const insertShiftDate = db.prepare(
      "INSERT INTO ShiftDate (shift_date_id, quarter_id, date, shift_type_id, is_weekend) VALUES (?, ?, ?, ?, ?)"
    );
    for (const sd of data.shift_dates) {
      insertShiftDate.run(sd.shift_date_id, q.quarter_id, sd.date, sd.shift_type_id, sd.is_weekend ? 1 : 0);
    }

    const insertAssignment = db.prepare(
      `INSERT INTO ShiftAssignment (assignment_id, shift_date_id, worker_id, assigned_by, is_forced, force_reason, assigned_at, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of data.assignments) {
      insertAssignment.run(
        uuid(),
        a.shift_date_id,
        a.worker_id,
        "import",
        a.is_forced ? 1 : 0,
        a.force_reason,
        a.assigned_at,
        a.role ?? "shift"
      );
    }

    const insertAvail = db.prepare(
      "INSERT INTO WorkerAvailability (availability_id, worker_id, quarter_id, date, status) VALUES (?, ?, ?, ?, ?)"
    );
    for (const av of data.worker_availability) {
      insertAvail.run(uuid(), av.worker_id, q.quarter_id, av.date, av.status);
    }
  });

  try {
    importAll();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאה בייבוא";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true, quarter_id: data.quarter.quarter_id });
}
