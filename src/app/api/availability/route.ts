import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  readAvailability,
  replaceAvailability,
  validateEntries,
  type AvailabilityEntry,
} from "@/lib/availability-repo";
import { AVAILABILITY_SOURCES, type AvailabilitySource } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }

  const quarterId = req.nextUrl.searchParams.get("quarter_id");
  const allWorkers = req.nextUrl.searchParams.get("all") === "true";
  const workerId = req.nextUrl.searchParams.get("worker_id") || session.worker_id;

  const db = getDb();

  // Whole-quarter read, for the admin import/review screens.
  if (allWorkers) {
    if (!session.is_admin) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    if (!quarterId) {
      return NextResponse.json({ error: "נדרש רבעון" }, { status: 400 });
    }
    const rows = db
      .prepare(
        "SELECT * FROM WorkerAvailability WHERE quarter_id = ? ORDER BY worker_id, date"
      )
      .all(quarterId);
    return NextResponse.json(rows);
  }

  // Non-admin can only read their own.
  if (!session.is_admin && workerId !== session.worker_id) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  let query = "SELECT * FROM WorkerAvailability WHERE worker_id = ?";
  const params: string[] = [workerId];

  if (quarterId) {
    query += " AND quarter_id = ?";
    params.push(quarterId);
  }

  query += " ORDER BY date";
  return NextResponse.json(db.prepare(query).all(...params));
}

/**
 * Replaces a worker's availability for one quarter.
 *
 * The delete is scoped to a single `source`, so each channel only ever clears
 * its own rows: a worker saving their calendar cannot wipe admin-imported
 * constraints, and re-running a form import cannot wipe what the worker
 * entered themselves.
 *
 * A non-admin may only write their own rows, always as source `worker`.
 * An admin may target another worker via `worker_id` and choose the source.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }

  const body = await req.json();
  const { quarter_id, entries } = body as {
    quarter_id?: string;
    entries?: AvailabilityEntry[];
  };

  if (!quarter_id || !Array.isArray(entries)) {
    return NextResponse.json({ error: "נדרש רבעון ורשימת זמינות" }, { status: 400 });
  }

  // Resolve target worker + source based on who is calling.
  let workerId = session.worker_id;
  let source: AvailabilitySource = "worker";

  if (session.is_admin) {
    if (typeof body.worker_id === "string" && body.worker_id) {
      workerId = body.worker_id;
      source = "admin";
    }
    if (typeof body.source === "string") {
      if (!AVAILABILITY_SOURCES.includes(body.source as AvailabilitySource)) {
        return NextResponse.json({ error: "מקור לא תקין" }, { status: 400 });
      }
      source = body.source as AvailabilitySource;
    }
  } else if (body.worker_id && body.worker_id !== session.worker_id) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const db = getDb();

  const quarter = db.prepare("SELECT quarter_id FROM Quarter WHERE quarter_id = ?").get(quarter_id);
  if (!quarter) {
    return NextResponse.json({ error: "רבעון לא נמצא" }, { status: 404 });
  }

  const worker = db.prepare("SELECT worker_id FROM Worker WHERE worker_id = ?").get(workerId);
  if (!worker) {
    return NextResponse.json({ error: "עובד לא נמצא" }, { status: 404 });
  }

  // Validate up front so a bad payload fails whole rather than half-applying.
  const invalid = validateEntries(entries);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  db.transaction(() => {
    replaceAvailability(db, { workerId, quarterId: quarter_id, source, entries });
  })();

  return NextResponse.json(readAvailability(db, workerId, quarter_id));
}
