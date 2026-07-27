import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWorkerWarnings } from "@/lib/shift-rules";
import { v4 as uuid } from "uuid";

export async function GET(req: NextRequest) {
  const quarterId = req.nextUrl.searchParams.get("quarter_id");
  const db = getDb();

  let query = `
    SELECT sa.*, sd.date, sd.shift_type_id, sd.is_weekend, sd.quarter_id,
           w.name as worker_name, w.branch as worker_branch, w.rank_id,
           st.name as shift_type_name
    FROM ShiftAssignment sa
    JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id
    JOIN Worker w ON w.worker_id = sa.worker_id
    JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id
  `;
  const params: string[] = [];

  if (quarterId) {
    query += " WHERE sd.quarter_id = ?";
    params.push(quarterId);
  }
  query += " ORDER BY sd.date";

  const assignments = db.prepare(query).all(...params);
  return NextResponse.json(assignments);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await req.json();
  const { shift_date_id, worker_id, is_forced, force_reason, role = "shift" } = body as {
    shift_date_id: string;
    worker_id: string;
    is_forced?: boolean;
    force_reason?: string;
    role?: "shift" | "reserve";
  };

  if (!shift_date_id || !worker_id) {
    return NextResponse.json(
      { error: "נדרש תאריך משמרת ומספר עובד" },
      { status: 400 }
    );
  }

  if (role !== "shift" && role !== "reserve") {
    return NextResponse.json({ error: "תפקיד לא תקין" }, { status: 400 });
  }

  const db = getDb();

  const shiftDate = db
    .prepare("SELECT * FROM ShiftDate WHERE shift_date_id = ?")
    .get(shift_date_id) as { shift_date_id: string; quarter_id: string; date: string; shift_type_id: string; is_weekend: number } | undefined;

  if (!shiftDate) {
    return NextResponse.json({ error: "תאריך משמרת לא נמצא" }, { status: 404 });
  }

  const warnings = getWorkerWarnings(worker_id, shift_date_id, role);
  const hasRedWarnings = warnings.some((w) => w.severity === "red");

  if (hasRedWarnings && !is_forced) {
    return NextResponse.json(
      { error: "שיבוץ זה חורג מהכללים", warnings, requiresForce: true },
      { status: 422 }
    );
  }

  if (is_forced && (!force_reason || force_reason.trim().length === 0)) {
    return NextResponse.json(
      { error: "נדרשת סיבה לשיבוץ כפוי" },
      { status: 400 }
    );
  }

  // Remove existing assignment for this shift date + role
  const existing = db
    .prepare("SELECT worker_id FROM ShiftAssignment WHERE shift_date_id = ? AND role = ?")
    .get(shift_date_id, role) as { worker_id: string } | undefined;

  if (existing) {
    if (role === "shift") {
      db.prepare("DELETE FROM ShiftHistory WHERE worker_id = ? AND shift_date_id = ?").run(existing.worker_id, shift_date_id);
    }
    db.prepare("DELETE FROM ShiftAssignment WHERE shift_date_id = ? AND role = ?").run(shift_date_id, role);
  }

  const assignmentId = uuid();
  db.prepare(
    `INSERT INTO ShiftAssignment (assignment_id, shift_date_id, worker_id, assigned_by, is_forced, force_reason, role)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assignmentId,
    shift_date_id,
    worker_id,
    session.worker_id,
    is_forced ? 1 : 0,
    is_forced ? force_reason : null,
    role
  );

  if (role === "shift") {
    const historyId = uuid();
    db.prepare(
      `INSERT OR REPLACE INTO ShiftHistory (history_id, worker_id, quarter_id, shift_date_id, was_weekend)
       VALUES (?, ?, ?, ?, ?)`
    ).run(historyId, worker_id, shiftDate.quarter_id, shift_date_id, shiftDate.shift_type_id === "GUARD" ? 0 : shiftDate.is_weekend);
  }

  return NextResponse.json({ assignment_id: assignmentId, warnings });
}

export async function DELETE(req: NextRequest) {
  const assignmentId = req.nextUrl.searchParams.get("assignment_id");
  const shiftDateId = req.nextUrl.searchParams.get("shift_date_id");
  const role = req.nextUrl.searchParams.get("role") as "shift" | "reserve" | null;

  const db = getDb();

  if (assignmentId) {
    const assignment = db.prepare("SELECT * FROM ShiftAssignment WHERE assignment_id = ?").get(assignmentId) as { worker_id: string; shift_date_id: string; role: string } | undefined;
    if (assignment && assignment.role === "shift") {
      db.prepare("DELETE FROM ShiftHistory WHERE worker_id = ? AND shift_date_id = ?").run(assignment.worker_id, assignment.shift_date_id);
    }
    const result = db.prepare("DELETE FROM ShiftAssignment WHERE assignment_id = ?").run(assignmentId);
    if (result.changes === 0) {
      return NextResponse.json({ error: "שיבוץ לא נמצא" }, { status: 404 });
    }
  } else if (shiftDateId) {
    if (role) {
      const assignment = db.prepare("SELECT * FROM ShiftAssignment WHERE shift_date_id = ? AND role = ?").get(shiftDateId, role) as { worker_id: string; shift_date_id: string } | undefined;
      if (assignment) {
        if (role === "shift") {
          db.prepare("DELETE FROM ShiftHistory WHERE worker_id = ? AND shift_date_id = ?").run(assignment.worker_id, assignment.shift_date_id);
        }
        db.prepare("DELETE FROM ShiftAssignment WHERE shift_date_id = ? AND role = ?").run(shiftDateId, role);
      }
    } else {
      // Delete all assignments for this shift date — only remove history for shift role
      const assignments = db.prepare("SELECT * FROM ShiftAssignment WHERE shift_date_id = ?").all(shiftDateId) as { worker_id: string; shift_date_id: string; role: string }[];
      for (const a of assignments) {
        if (a.role === "shift") {
          db.prepare("DELETE FROM ShiftHistory WHERE worker_id = ? AND shift_date_id = ?").run(a.worker_id, a.shift_date_id);
        }
      }
      db.prepare("DELETE FROM ShiftAssignment WHERE shift_date_id = ?").run(shiftDateId);
    }
  } else {
    return NextResponse.json({ error: "נדרש מזהה שיבוץ או תאריך משמרת" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
