import { NextRequest, NextResponse } from "next/server";
import { getWorkerWarnings, getSortedWorkers } from "@/lib/shift-rules";

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get("worker_id");
  const shiftDateId = req.nextUrl.searchParams.get("shift_date_id");
  const roleParam = req.nextUrl.searchParams.get("role");
  const role = (roleParam === "reserve" ? "reserve" : "shift") as "shift" | "reserve";

  if (workerId && shiftDateId) {
    const warnings = getWorkerWarnings(workerId, shiftDateId, role);
    return NextResponse.json({ warnings });
  }

  if (shiftDateId) {
    const workers = getSortedWorkers(shiftDateId, role);
    return NextResponse.json(workers);
  }

  return NextResponse.json(
    { error: "נדרש לפחות shift_date_id" },
    { status: 400 }
  );
}
