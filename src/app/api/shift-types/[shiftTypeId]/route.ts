import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger } from "@/lib/validation";
import { withApiErrors, updateOrNotFound, deleteOrNotFound } from "@/lib/api-helpers";

type Params = { params: Promise<{ shiftTypeId: string }> };

export const PUT = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const { shiftTypeId } = await params;
  const body = await req.json();
  const name = validateString(body.name, "שם סוג משמרת", 100);
  const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

  return updateOrNotFound({
    table: "ShiftType",
    idColumn: "shift_type_id",
    id: shiftTypeId,
    set: { name, display_order },
    notFoundMessage: "סוג משמרת לא נמצא",
  });
});

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { shiftTypeId } = await params;
  const db = getDb();

  const shiftCount = db.prepare("SELECT COUNT(*) as count FROM ShiftDate WHERE shift_type_id = ?").get(shiftTypeId) as { count: number };
  if (shiftCount.count > 0) {
    return NextResponse.json({ error: `לא ניתן למחוק — ${shiftCount.count} תאריכי משמרות משויכים לסוג זה` }, { status: 409 });
  }

  return deleteOrNotFound({ table: "ShiftType", idColumn: "shift_type_id", id: shiftTypeId, notFoundMessage: "סוג משמרת לא נמצא" });
}
