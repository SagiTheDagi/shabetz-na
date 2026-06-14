import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger, ValidationError } from "@/lib/validation";

export async function GET() {
  const db = getDb();
  const ranks = db.prepare("SELECT * FROM Rank ORDER BY display_order").all();
  return NextResponse.json(ranks);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rank_id = validateString(body.rank_id, "קוד דרגה", 20);
    const name = validateString(body.name, "שם דרגה", 100);
    const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

    const db = getDb();
    const existing = db.prepare("SELECT rank_id FROM Rank WHERE rank_id = ?").get(rank_id);
    if (existing) {
      return NextResponse.json({ error: "דרגה עם קוד זה כבר קיימת" }, { status: 409 });
    }

    db.prepare("INSERT INTO Rank (rank_id, name, display_order) VALUES (?, ?, ?)").run(rank_id, name, display_order);
    const created = db.prepare("SELECT * FROM Rank WHERE rank_id = ?").get(rank_id);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
