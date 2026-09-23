import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  replaceAvailability,
  validateEntries,
  type AvailabilityEntry,
} from "@/lib/availability-repo";
import { AVAILABILITY_SOURCES, type AvailabilitySource } from "@/lib/types";

interface BulkWorker {
  worker_id: string;
  entries: AvailabilityEntry[];
}

/**
 * Commits parsed availability for many workers in one transaction.
 *
 * This is what the form-response import calls once the admin has reviewed the
 * parsed constraints. Admin-only — the `/api/availability` middleware rule only
 * requires a session, so the role check lives here.
 *
 * Replacement is scoped to `(worker, quarter, source)`, matching the single
 * -worker endpoint: re-running an import refreshes only previously imported
 * rows and leaves the worker's own submissions untouched.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await req.json();
  const { quarter_id, workers } = body as {
    quarter_id?: string;
    workers?: BulkWorker[];
  };

  if (!quarter_id || !Array.isArray(workers)) {
    return NextResponse.json({ error: "נדרש רבעון ורשימת עובדים" }, { status: 400 });
  }

  let source: AvailabilitySource = "form_import";
  if (typeof body.source === "string") {
    if (!AVAILABILITY_SOURCES.includes(body.source as AvailabilitySource)) {
      return NextResponse.json({ error: "מקור לא תקין" }, { status: 400 });
    }
    source = body.source as AvailabilitySource;
  }

  const db = getDb();

  const quarter = db.prepare("SELECT quarter_id FROM Quarter WHERE quarter_id = ?").get(quarter_id);
  if (!quarter) {
    return NextResponse.json({ error: "רבעון לא נמצא" }, { status: 404 });
  }

  // Validate everything before touching the DB — a bad row must not leave a
  // half-finished import behind.
  const knownWorker = db.prepare("SELECT name FROM Worker WHERE worker_id = ?");

  for (const w of workers) {
    if (!w || typeof w.worker_id !== "string" || !Array.isArray(w.entries)) {
      return NextResponse.json({ error: "מבנה נתונים לא תקין" }, { status: 400 });
    }
    const worker = knownWorker.get(w.worker_id) as { name: string } | undefined;
    if (!worker) {
      return NextResponse.json({ error: `עובד לא נמצא: ${w.worker_id}` }, { status: 404 });
    }

    const invalid = validateEntries(w.entries, `${worker.name} (${w.worker_id})`);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
  }

  let written = 0;
  db.transaction(() => {
    for (const w of workers) {
      written += replaceAvailability(db, {
        workerId: w.worker_id,
        quarterId: quarter_id,
        source,
        entries: w.entries,
      });
    }
  })();

  return NextResponse.json({
    ok: true,
    workers: workers.length,
    entries: written,
    source,
  });
}
