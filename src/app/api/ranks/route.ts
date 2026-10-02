import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateString, validateInteger } from "@/lib/validation";
import { withApiErrors, insertOrConflict } from "@/lib/api-helpers";

export async function GET() {
  const db = getDb();
  const ranks = db.prepare("SELECT * FROM Rank ORDER BY display_order").all();
  return NextResponse.json(ranks);
}

export const POST = withApiErrors(async (req: Request) => {
  const body = await req.json();
  const rank_id = validateString(body.rank_id, "קוד דרגה", 20);
  const name = validateString(body.name, "שם דרגה", 100);
  const display_order = validateInteger(body.display_order ?? 0, "סדר הצגה");

  return insertOrConflict({
    table: "Rank",
    idColumn: "rank_id",
    row: { rank_id, name, display_order },
    conflictMessage: "דרגה עם קוד זה כבר קיימת",
  });
});
