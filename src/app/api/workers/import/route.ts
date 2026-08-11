import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface WorkerRow {
  worker_id: string;
  name: string;
  rank_id: string;
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
  release_date: string | null;
  notes: string | null;
  branch: string | null;
  team: string | null;
  phone: string | null;
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
    `INSERT INTO Worker (worker_id, name, rank_id, is_admin, password_hash, is_exempt, exemption_reason, receives_shift_allocation, release_date, notes, branch, team, phone)
     VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // COALESCE(?, col) keeps the existing value when the imported field is null,
  // so an incomplete import never wipes data that's already filled in.
  const update = db.prepare(
    `UPDATE Worker SET
       name = COALESCE(?, name),
       rank_id = COALESCE(?, rank_id),
       is_exempt = COALESCE(?, is_exempt),
       exemption_reason = COALESCE(?, exemption_reason),
       receives_shift_allocation = COALESCE(?, receives_shift_allocation),
       release_date = COALESCE(?, release_date),
       notes = COALESCE(?, notes),
       branch = COALESCE(?, branch),
       team = COALESCE(?, team),
       phone = COALESCE(?, phone),
       updated_at = datetime('now')
     WHERE worker_id = ?`
  );

  const created: string[] = [];
  const updated: string[] = [];
  const archived: string[] = [];
  const errors: string[] = [];

  const run = db.transaction(() => {
    const importedIds = new Set<string>();

    for (const row of rows) {
      if (!row.worker_id || !row.name || !row.rank_id) {
        errors.push(`שורה חסרה נתונים: ${JSON.stringify(row)}`);
        continue;
      }
      if (!ranks.has(row.rank_id)) {
        errors.push(`דרגה לא קיימת "${row.rank_id}" עבור עובד ${row.worker_id}`);
        continue;
      }

      importedIds.add(row.worker_id);

      const existing = db
        .prepare("SELECT worker_id FROM Worker WHERE worker_id = ?")
        .get(row.worker_id);

      if (existing) {
        // Restore if previously archived and re-appears in file
        update.run(
          row.name ?? null,
          row.rank_id ?? null,
          row.is_exempt ?? null,
          row.exemption_reason ?? null,
          row.receives_shift_allocation ?? null,
          row.release_date ?? null,
          row.notes ?? null,
          row.branch ?? null,
          row.team ?? null,
          row.phone ?? null,
          row.worker_id
        );
        db.prepare(
          "UPDATE Worker SET is_archived = 0, updated_at = datetime('now') WHERE worker_id = ? AND is_archived = 1"
        ).run(row.worker_id);
        updated.push(row.worker_id);
      } else {
        insert.run(
          row.worker_id,
          row.name,
          row.rank_id,
          row.is_exempt,
          row.exemption_reason,
          row.receives_shift_allocation,
          row.release_date ?? null,
          row.notes ?? null,
          row.branch ?? null,
          row.team ?? null,
          row.phone ?? null
        );
        created.push(row.worker_id);
      }
    }

    // Archive active workers not present in the import file
    const activeWorkers = db
      .prepare("SELECT worker_id FROM Worker WHERE is_archived = 0 AND is_admin = 0")
      .all() as { worker_id: string }[];

    for (const { worker_id } of activeWorkers) {
      if (!importedIds.has(worker_id)) {
        db.prepare(
          "UPDATE Worker SET is_archived = 1, updated_at = datetime('now') WHERE worker_id = ?"
        ).run(worker_id);
        archived.push(worker_id);
      }
    }
  });

  run();

  return NextResponse.json({ created: created.length, updated: updated.length, archived: archived.length, errors });
}
