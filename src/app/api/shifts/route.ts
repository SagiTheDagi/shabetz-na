import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function GET(req: NextRequest) {
  const quarterId = req.nextUrl.searchParams.get("quarter_id");
  const db = getDb();

  if (quarterId) {
    const shifts = db
      .prepare(
        `SELECT sd.*, st.name as shift_type_name
         FROM ShiftDate sd
         JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id
         WHERE sd.quarter_id = ?
         ORDER BY sd.date`
      )
      .all(quarterId);
    return NextResponse.json(shifts);
  }

  const shifts = db
    .prepare(
      `SELECT sd.*, st.name as shift_type_name
       FROM ShiftDate sd
       JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id
       ORDER BY sd.date`
    )
    .all();
  return NextResponse.json(shifts);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { quarter_id, dates } = body as {
    quarter_id: string;
    dates: { date: string; shift_type_id: string; is_weekend: boolean }[];
  };

  if (!quarter_id || !Array.isArray(dates) || dates.length === 0) {
    return NextResponse.json({ error: "נדרש רבעון ורשימת תאריכים" }, { status: 400 });
  }

  const db = getDb();

  const quarter = db.prepare("SELECT quarter_id FROM Quarter WHERE quarter_id = ?").get(quarter_id);
  if (!quarter) {
    return NextResponse.json({ error: "רבעון לא נמצא" }, { status: 404 });
  }

  const insert = db.prepare(
    "INSERT INTO ShiftDate (shift_date_id, quarter_id, date, shift_type_id, is_weekend) VALUES (?, ?, ?, ?, ?)"
  );

  const insertAll = db.transaction(() => {
    for (const d of dates) {
      const shiftType = db.prepare("SELECT shift_type_id FROM ShiftType WHERE shift_type_id = ?").get(d.shift_type_id);
      if (!shiftType) {
        throw new Error(`סוג משמרת לא נמצא: ${d.shift_type_id}`);
      }
      insert.run(uuid(), quarter_id, d.date, d.shift_type_id, d.is_weekend ? 1 : 0);
    }
  });

  try {
    insertAll();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאה בהוספת תאריכים";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const created = db
    .prepare(
      `SELECT sd.*, st.name as shift_type_name
       FROM ShiftDate sd
       JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id
       WHERE sd.quarter_id = ?
       ORDER BY sd.date`
    )
    .all(quarter_id);

  return NextResponse.json(created, { status: 201 });
}
