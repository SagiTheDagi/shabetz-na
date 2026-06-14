import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger, ValidationError } from "@/lib/validation";

type Params = { params: Promise<{ rankId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { rankId } = await params;
    const body = await req.json();
    const name = validateString(body.name, "שם דרגה", 100);
    const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

    const db = getDb();
    const result = db.prepare("UPDATE Rank SET name = ?, display_order = ? WHERE rank_id = ?").run(name, display_order, rankId);
    if (result.changes === 0) {
      return NextResponse.json({ error: "דרגה לא נמצאה" }, { status: 404 });
    }
    const updated = db.prepare("SELECT * FROM Rank WHERE rank_id = ?").get(rankId);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { rankId } = await params;
  const db = getDb();

  const workerCount = db.prepare("SELECT COUNT(*) as count FROM Worker WHERE rank_id = ?").get(rankId) as { count: number };
  if (workerCount.count > 0) {
    return NextResponse.json({ error: `לא ניתן למחוק — ${workerCount.count} עובדים משויכים לדרגה זו` }, { status: 409 });
  }

  const result = db.prepare("DELETE FROM Rank WHERE rank_id = ?").run(rankId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "דרגה לא נמצאה" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
