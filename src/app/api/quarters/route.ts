import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString } from "@/lib/validation";
import { requireSession, requireAdmin } from "@/lib/auth";
import { withApiErrors, insertOrConflict } from "@/lib/api-helpers";

export const GET = withApiErrors(async () => {
  await requireSession();
  const db = getDb();
  const quarters = db.prepare("SELECT * FROM Quarter ORDER BY start_date DESC").all();
  return NextResponse.json(quarters);
});

export const POST = withApiErrors(async (req: Request) => {
  await requireAdmin();
  const body = await req.json();
  const quarter_id = validateString(body.quarter_id, "מזהה רבעון", 10);
  const start_date = validateString(body.start_date, "תאריך התחלה", 10);
  const end_date = validateString(body.end_date, "תאריך סיום", 10);

  if (!/^\d{4}-Q[1-4]$/.test(quarter_id)) {
    return NextResponse.json({ error: "פורמט רבעון לא תקין (דוגמה: 2026-Q1)" }, { status: 400 });
  }

  return insertOrConflict({
    table: "Quarter",
    idColumn: "quarter_id",
    row: { quarter_id, start_date, end_date, status: "draft" },
    conflictMessage: "רבעון זה כבר קיים",
  });
});
