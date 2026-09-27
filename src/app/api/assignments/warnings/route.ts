import { NextRequest, NextResponse } from "next/server";
import { getWorkerWarnings, getSortedWorkers } from "@/lib/shift-rules";

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get("worker_id");
  const shiftDateId = req.nextUrl.searchParams.get("shift_date_id");
  const roleParam = req.nextUrl.searchParams.get("role");
  const role = (roleParam === "reserve" ? "reserve" : "shift") as "shift" | "reserve";

  if (!shiftDateId) {
    return NextResponse.json(
      { error: "נדרש לפחות shift_date_id" },
      { status: 400 }
    );
  }

  // Any DB error here used to bubble up as an empty-bodied 500, which the client
  // then tried to JSON.parse. Always answer with a JSON body.
  try {
    if (workerId) {
      const warnings = getWorkerWarnings(workerId, shiftDateId, role);
      return NextResponse.json({ warnings });
    }

    const workers = getSortedWorkers(shiftDateId, role);
    return NextResponse.json(workers);
  } catch (err) {
    console.error("GET /api/assignments/warnings failed:", err);
    return NextResponse.json(
      { error: "שגיאה בטעינת מועמדים למשמרת" },
      { status: 500 }
    );
  }
}
