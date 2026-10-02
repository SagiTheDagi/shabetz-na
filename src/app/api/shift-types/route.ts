import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger } from "@/lib/validation";
import { withApiErrors, insertOrConflict } from "@/lib/api-helpers";

export async function GET() {
  const db = getDb();
  const types = db.prepare("SELECT * FROM ShiftType ORDER BY display_order").all();
  return NextResponse.json(types);
}

export const POST = withApiErrors(async (req: Request) => {
  const body = await req.json();
  const shift_type_id = validateString(body.shift_type_id, "קוד סוג משמרת", 30);
  const name = validateString(body.name, "שם סוג משמרת", 100);
  const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

  return insertOrConflict({
    table: "ShiftType",
    idColumn: "shift_type_id",
    row: { shift_type_id, name, display_order },
    conflictMessage: "סוג משמרת עם קוד זה כבר קיים",
  });
});
