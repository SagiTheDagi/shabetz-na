import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger, ValidationError } from "@/lib/validation";

type Params = { params: Promise<{ shiftTypeId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { shiftTypeId } = await params;
    const body = await req.json();
    const name = validateString(body.name, "שם סוג משמרת", 100);
    const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

    const db = getDb();
    const result = db.prepare("UPDATE ShiftType SET name = ?, display_order = ? WHERE shift_type_id = ?").run(name, display_order, shiftTypeId);
    if (result.changes === 0) {
      return NextResponse.json({ error: "סוג משמרת לא נמצא" }, { status: 404 });
    }
    const updated = db.prepare("SELECT * FROM ShiftType WHERE shift_type_id = ?").get(shiftTypeId);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { shiftTypeId } = await params;
  const db = getDb();

  const shiftCount = db.prepare("SELECT COUNT(*) as count FROM ShiftDate WHERE shift_type_id = ?").get(shiftTypeId) as { count: number };
  if (shiftCount.count > 0) {
    return NextResponse.json({ error: `לא ניתן למחוק — ${shiftCount.count} תאריכי משמרות משויכים לסוג זה` }, { status: 409 });
  }

  const result = db.prepare("DELETE FROM ShiftType WHERE shift_type_id = ?").run(shiftTypeId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "סוג משמרת לא נמצא" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
