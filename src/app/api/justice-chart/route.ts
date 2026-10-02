import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireSession } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";
import { buildChartData, recomputeJusticeChart } from "@/lib/justice-chart";

export const GET = withApiErrors(async () => {
  await requireSession();
  return NextResponse.json(buildChartData(getDb()));
});

export const POST = withApiErrors(async () => {
  await requireAdmin();

  return NextResponse.json(recomputeJusticeChart(getDb()));
});
