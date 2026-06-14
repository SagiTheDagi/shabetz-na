import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger, ValidationError } from "@/lib/validation";

export async function GET() {
  const db = getDb();
  const types = db.prepare("SELECT * FROM ShiftType ORDER BY display_order").all();
  return NextResponse.json(types);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const shift_type_id = validateString(body.shift_type_id, "קוד סוג משמרת", 30);
    const name = validateString(body.name, "שם סוג משמרת", 100);
    const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

    const db = getDb();
    const existing = db.prepare("SELECT shift_type_id FROM ShiftType WHERE shift_type_id = ?").get(shift_type_id);
    if (existing) {
      return NextResponse.json({ error: "סוג משמרת עם קוד זה כבר קיים" }, { status: 409 });
    }

    db.prepare("INSERT INTO ShiftType (shift_type_id, name, display_order) VALUES (?, ?, ?)").run(shift_type_id, name, display_order);
    const created = db.prepare("SELECT * FROM ShiftType WHERE shift_type_id = ?").get(shift_type_id);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
