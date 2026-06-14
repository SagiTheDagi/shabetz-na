import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, ValidationError } from "@/lib/validation";

export async function GET() {
  const db = getDb();
  const quarters = db.prepare("SELECT * FROM Quarter ORDER BY start_date DESC").all();
  return NextResponse.json(quarters);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const quarter_id = validateString(body.quarter_id, "מזהה רבעון", 10);
    const start_date = validateString(body.start_date, "תאריך התחלה", 10);
    const end_date = validateString(body.end_date, "תאריך סיום", 10);

    if (!/^\d{4}-Q[1-4]$/.test(quarter_id)) {
      return NextResponse.json({ error: "פורמט רבעון לא תקין (דוגמה: 2026-Q1)" }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare("SELECT quarter_id FROM Quarter WHERE quarter_id = ?").get(quarter_id);
    if (existing) {
      return NextResponse.json({ error: "רבעון זה כבר קיים" }, { status: 409 });
    }

    db.prepare(
      "INSERT INTO Quarter (quarter_id, start_date, end_date, status) VALUES (?, ?, ?, 'draft')"
    ).run(quarter_id, start_date, end_date);

    const created = db.prepare("SELECT * FROM Quarter WHERE quarter_id = ?").get(quarter_id);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
