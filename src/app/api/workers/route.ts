import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { validateString, validateOptionalString, validateBoolean, ValidationError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const db = getDb();
  const includeExempt = req.nextUrl.searchParams.get("include_exempt") === "true";
  const includeArchived = req.nextUrl.searchParams.get("include_archived") === "true";

  const conditions: string[] = [];
  if (!includeArchived) conditions.push("w.is_archived = 0");
  if (!includeExempt) conditions.push("w.is_exempt = 0");

  let query = `
    SELECT w.*, r.name as rank_name
    FROM Worker w
    JOIN Rank r ON r.rank_id = w.rank_id
  `;
  if (conditions.length > 0) query += ` WHERE ${conditions.join(" AND ")}`;
  query += " ORDER BY r.display_order, w.name";

  const workers = db.prepare(query).all();
  return NextResponse.json(workers);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const worker_id = validateString(body.worker_id, "מספר עובד", 50);
    const name = validateString(body.name, "שם עובד", 100);
    const rank_id = validateString(body.rank_id, "דרגה", 20);
    const is_admin = validateBoolean(body.is_admin);
    const is_exempt = validateBoolean(body.is_exempt);
    const exemption_reason = is_exempt
      ? validateString(body.exemption_reason, "סיבת פטור", 500)
      : null;
    const receives_shift_allocation = validateBoolean(body.receives_shift_allocation ?? true);
    const branch = validateOptionalString(body.branch, "ענף", 100);
    const team = validateOptionalString(body.team, "צוות", 100);

    const db = getDb();

    const existing = db.prepare("SELECT worker_id FROM Worker WHERE worker_id = ?").get(worker_id);
    if (existing) {
      return NextResponse.json({ error: "עובד עם מספר זה כבר קיים" }, { status: 409 });
    }

    const rankExists = db.prepare("SELECT rank_id FROM Rank WHERE rank_id = ?").get(rank_id);
    if (!rankExists) {
      return NextResponse.json({ error: "דרגה לא נמצאה" }, { status: 400 });
    }

    let password_hash: string | null = null;
    if (is_admin && body.password) {
      password_hash = await hashPassword(body.password);
    }

    db.prepare(
      `INSERT INTO Worker (worker_id, name, rank_id, is_admin, password_hash, is_exempt, exemption_reason, receives_shift_allocation, branch, team)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(worker_id, name, rank_id, is_admin, password_hash, is_exempt, exemption_reason, receives_shift_allocation, branch, team);

    const created = db.prepare(
      "SELECT w.*, r.name as rank_name FROM Worker w JOIN Rank r ON r.rank_id = w.rank_id WHERE w.worker_id = ?"
    ).get(worker_id);

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
