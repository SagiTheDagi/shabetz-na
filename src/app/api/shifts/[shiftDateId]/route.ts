import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  isWeekendDate,
  validateShiftDate,
  SHIFT_DATE_ISSUE_MESSAGES,
  type ShiftDateSibling,
} from "@/lib/shift-date-validation";

type Params = { params: Promise<{ shiftDateId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { shiftDateId } = await params;
  const db = getDb();

  const result = db.prepare("DELETE FROM ShiftDate WHERE shift_date_id = ?").run(shiftDateId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "תאריך משמרת לא נמצא" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { shiftDateId } = await params;
  const body = await req.json();
  const db = getDb();

  const current = db
    .prepare("SELECT quarter_id FROM ShiftDate WHERE shift_date_id = ?")
    .get(shiftDateId) as { quarter_id: string } | undefined;
  if (!current) {
    return NextResponse.json({ error: "תאריך משמרת לא נמצא" }, { status: 404 });
  }

  const draft = { date: String(body.date ?? ""), shift_type_id: String(body.shift_type_id ?? "") };
  if (!db.prepare("SELECT 1 FROM ShiftType WHERE shift_type_id = ?").get(draft.shift_type_id)) {
    return NextResponse.json({ error: "סוג משמרת לא נמצא" }, { status: 400 });
  }

  const quarter = db
    .prepare("SELECT start_date, end_date FROM Quarter WHERE quarter_id = ?")
    .get(current.quarter_id) as { start_date: string; end_date: string };
  const siblings = db
    .prepare("SELECT shift_date_id, date, shift_type_id FROM ShiftDate WHERE quarter_id = ?")
    .all(current.quarter_id) as ShiftDateSibling[];

  const issue = validateShiftDate(draft, quarter, siblings, shiftDateId);
  if (issue) {
    return NextResponse.json({ error: SHIFT_DATE_ISSUE_MESSAGES[issue] }, { status: 400 });
  }

  const is_weekend = isWeekendDate(draft.date) ? 1 : 0;
  db.transaction(() => {
    db.prepare("UPDATE ShiftDate SET date = ?, shift_type_id = ?, is_weekend = ? WHERE shift_date_id = ?").run(
      draft.date,
      draft.shift_type_id,
      is_weekend,
      shiftDateId
    );
    db.prepare("UPDATE ShiftHistory SET was_weekend = ? WHERE shift_date_id = ?").run(is_weekend, shiftDateId);
  })();

  return NextResponse.json({ ok: true });
}
