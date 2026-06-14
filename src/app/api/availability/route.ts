import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import type { AvailabilityStatus } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }

  const quarterId = req.nextUrl.searchParams.get("quarter_id");
  const workerId = req.nextUrl.searchParams.get("worker_id") || session.worker_id;

  // Non-admin can only see their own
  if (!session.is_admin && workerId !== session.worker_id) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const db = getDb();
  let query = "SELECT * FROM WorkerAvailability WHERE worker_id = ?";
  const params: string[] = [workerId];

  if (quarterId) {
    query += " AND quarter_id = ?";
    params.push(quarterId);
  }

  query += " ORDER BY date";
  const availability = db.prepare(query).all(...params);
  return NextResponse.json(availability);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }

  const body = await req.json();
  const { quarter_id, entries } = body as {
    quarter_id: string;
    entries: { date: string; status: AvailabilityStatus }[];
  };

  if (!quarter_id || !Array.isArray(entries)) {
    return NextResponse.json({ error: "נדרש רבעון ורשימת זמינות" }, { status: 400 });
  }

  const validStatuses = ["unavailable", "prefer_work", "prefer_not_work"];
  const workerId = session.worker_id;
  const db = getDb();

  const upsert = db.transaction(() => {
    // Remove existing availability for this worker/quarter
    db.prepare("DELETE FROM WorkerAvailability WHERE worker_id = ? AND quarter_id = ?").run(workerId, quarter_id);

    const insert = db.prepare(
      "INSERT INTO WorkerAvailability (availability_id, worker_id, quarter_id, date, status) VALUES (?, ?, ?, ?, ?)"
    );

    for (const entry of entries) {
      if (!validStatuses.includes(entry.status)) continue;
      insert.run(uuid(), workerId, quarter_id, entry.date, entry.status);
    }
  });

  upsert();

  const result = db
    .prepare("SELECT * FROM WorkerAvailability WHERE worker_id = ? AND quarter_id = ? ORDER BY date")
    .all(workerId, quarter_id);

  return NextResponse.json(result);
}
