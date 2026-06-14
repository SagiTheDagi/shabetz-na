import { NextRequest, NextResponse } from "next/server";
import { getWorkerWarnings, getSortedWorkers } from "@/lib/shift-rules";

export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get("worker_id");
  const shiftDateId = req.nextUrl.searchParams.get("shift_date_id");

  if (workerId && shiftDateId) {
    const warnings = getWorkerWarnings(workerId, shiftDateId);
    return NextResponse.json({ warnings });
  }

  if (shiftDateId) {
    const workers = getSortedWorkers(shiftDateId);
    return NextResponse.json(workers);
  }

  return NextResponse.json(
    { error: "נדרש לפחות shift_date_id" },
    { status: 400 }
  );
}
