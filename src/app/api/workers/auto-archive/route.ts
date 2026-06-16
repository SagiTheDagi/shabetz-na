import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Archives active workers whose release_date + 1 quarter (3 months) has passed.
export async function POST() {
  const db = getDb();

  const result = db.prepare(`
    UPDATE Worker
    SET is_archived = 1, updated_at = datetime('now')
    WHERE is_archived = 0
      AND release_date IS NOT NULL
      AND date(release_date, '+3 months') < date('now')
  `).run();

  return NextResponse.json({ archived: result.changes });
}
