import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface WorkerRow {
  worker_id: string;
  name: string;
  rank_id: string;
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
}

export async function POST(req: Request) {
  const body = await req.json();
  const rows: WorkerRow[] = body.workers;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "נדרשת רשימת עובדים" }, { status: 400 });
  }

  const db = getDb();

  const ranks = new Set(
    (db.prepare("SELECT rank_id FROM Rank").all() as { rank_id: string }[]).map(
      (r) => r.rank_id
    )
  );

  const insert = db.prepare(
    `INSERT INTO Worker (worker_id, name, rank_id, is_admin, password_hash, is_exempt, exemption_reason, receives_shift_allocation)
     VALUES (?, ?, ?, 0, NULL, ?, ?, ?)`
  );

  const update = db.prepare(
    `UPDATE Worker SET name = ?, rank_id = ?, is_exempt = ?, exemption_reason = ?, receives_shift_allocation = ?, updated_at = datetime('now')
     WHERE worker_id = ?`
  );

  const created: string[] = [];
  const updated: string[] = [];
  const errors: string[] = [];

  const run = db.transaction(() => {
    for (const row of rows) {
      if (!row.worker_id || !row.name || !row.rank_id) {
        errors.push(`שורה חסרה נתונים: ${JSON.stringify(row)}`);
        continue;
      }
      if (!ranks.has(row.rank_id)) {
        errors.push(`דרגה לא קיימת "${row.rank_id}" עבור עובד ${row.worker_id}`);
        continue;
      }

      const existing = db
        .prepare("SELECT worker_id FROM Worker WHERE worker_id = ?")
        .get(row.worker_id);

      if (existing) {
        update.run(
          row.name,
          row.rank_id,
          row.is_exempt,
          row.exemption_reason,
          row.receives_shift_allocation,
          row.worker_id
        );
        updated.push(row.worker_id);
      } else {
        insert.run(
          row.worker_id,
          row.name,
          row.rank_id,
          row.is_exempt,
          row.exemption_reason,
          row.receives_shift_allocation
        );
        created.push(row.worker_id);
      }
    }
  });

  run();

  return NextResponse.json({ created: created.length, updated: updated.length, errors });
}
