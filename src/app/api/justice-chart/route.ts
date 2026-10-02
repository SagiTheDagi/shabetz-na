import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buildChartData, recomputeJusticeChart } from "@/lib/justice-chart";

export async function GET() {
  return NextResponse.json(buildChartData(getDb()));
}

export async function POST() {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  return NextResponse.json(recomputeJusticeChart(getDb()));
}
