import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger } from "@/lib/validation";
import { withApiErrors, updateOrNotFound, deleteOrNotFound } from "@/lib/api-helpers";

type Params = { params: Promise<{ rankId: string }> };

export const PUT = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const { rankId } = await params;
  const body = await req.json();
  const name = validateString(body.name, "שם דרגה", 100);
  const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

  return updateOrNotFound({
    table: "Rank",
    idColumn: "rank_id",
    id: rankId,
    set: { name, display_order },
    notFoundMessage: "דרגה לא נמצאה",
  });
});

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { rankId } = await params;
  const db = getDb();

  const workerCount = db.prepare("SELECT COUNT(*) as count FROM Worker WHERE rank_id = ?").get(rankId) as { count: number };
  if (workerCount.count > 0) {
    return NextResponse.json({ error: `לא ניתן למחוק — ${workerCount.count} עובדים משויכים לדרגה זו` }, { status: 409 });
  }

  return deleteOrNotFound({ table: "Rank", idColumn: "rank_id", id: rankId, notFoundMessage: "דרגה לא נמצאה" });
}
