import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const matrix = db
    .prepare(
      `SELECT e.*, r.name as rank_name, s.name as shift_type_name
       FROM RankShiftEligibility e
       JOIN Rank r ON r.rank_id = e.rank_id
       JOIN ShiftType s ON s.shift_type_id = e.shift_type_id
       ORDER BY r.display_order, s.display_order`
    )
    .all();
  return NextResponse.json(matrix);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { entries } = body as {
    entries: { rank_id: string; shift_type_id: string; priority: number | null }[];
  };

  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: "נדרש מערך entries" }, { status: 400 });
  }

  const db = getDb();

  const update = db.transaction(() => {
    db.prepare("DELETE FROM RankShiftEligibility").run();
    const insert = db.prepare(
      "INSERT INTO RankShiftEligibility (rank_id, shift_type_id, priority) VALUES (?, ?, ?)"
    );
    for (const e of entries) {
      insert.run(e.rank_id, e.shift_type_id, e.priority ?? null);
    }
  });

  update();

  const matrix = db
    .prepare(
      `SELECT e.*, r.name as rank_name, s.name as shift_type_name
       FROM RankShiftEligibility e
       JOIN Rank r ON r.rank_id = e.rank_id
       JOIN ShiftType s ON s.shift_type_id = e.shift_type_id
       ORDER BY r.display_order, s.display_order`
    )
    .all();
  return NextResponse.json(matrix);
}
