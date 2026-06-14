import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { validateString, validateBoolean, ValidationError } from "@/lib/validation";

type Params = { params: Promise<{ workerId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { workerId } = await params;
    const body = await req.json();
    const name = validateString(body.name, "שם עובד", 100);
    const rank_id = validateString(body.rank_id, "דרגה", 20);
    const is_admin = validateBoolean(body.is_admin);
    const is_exempt = validateBoolean(body.is_exempt);
    const exemption_reason = is_exempt
      ? validateString(body.exemption_reason, "סיבת פטור", 500)
      : null;
    const receives_shift_allocation = validateBoolean(body.receives_shift_allocation ?? true);

    const db = getDb();

    const rankExists = db.prepare("SELECT rank_id FROM Rank WHERE rank_id = ?").get(rank_id);
    if (!rankExists) {
      return NextResponse.json({ error: "דרגה לא נמצאה" }, { status: 400 });
    }

    let password_hash_update = "";
    const values: unknown[] = [name, rank_id, is_admin, is_exempt, exemption_reason, receives_shift_allocation];

    if (is_admin && body.password) {
      const hash = await hashPassword(body.password);
      password_hash_update = ", password_hash = ?";
      values.push(hash);
    }

    values.push(workerId);

    const result = db.prepare(
      `UPDATE Worker SET name = ?, rank_id = ?, is_admin = ?, is_exempt = ?, exemption_reason = ?, receives_shift_allocation = ?, updated_at = datetime('now')${password_hash_update} WHERE worker_id = ?`
    ).run(...values);

    if (result.changes === 0) {
      return NextResponse.json({ error: "עובד לא נמצא" }, { status: 404 });
    }

    const updated = db.prepare(
      "SELECT w.*, r.name as rank_name FROM Worker w JOIN Rank r ON r.rank_id = w.rank_id WHERE w.worker_id = ?"
    ).get(workerId);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workerId } = await params;
  const db = getDb();

  const assignmentCount = db.prepare(
    "SELECT COUNT(*) as count FROM ShiftAssignment WHERE worker_id = ?"
  ).get(workerId) as { count: number };

  if (assignmentCount.count > 0) {
    return NextResponse.json(
      { error: `לא ניתן למחוק — לעובד ${assignmentCount.count} שיבוצים` },
      { status: 409 }
    );
  }

  const result = db.prepare("DELETE FROM Worker WHERE worker_id = ?").run(workerId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "עובד לא נמצא" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
