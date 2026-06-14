import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
