import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";
import { ensureInsightsSchema } from "@/lib/insights/views";
import { getBudget, currentMonth, MONTHLY_CAP_USD } from "@/lib/insights/budget";
import { insightsEnabled } from "@/lib/insights/config";

/** Current month's assistant spend, the cap, and whether the assistant is configured. */
export const GET = withApiErrors(async () => {
  await requireAdmin();
  ensureInsightsSchema();
  const month = currentMonth();
  const cost_usd = getBudget(getDb()).monthCost(month); // InsightUsage exists: ensureInsightsSchema above
  return NextResponse.json({ month, cost_usd, cap: MONTHLY_CAP_USD, enabled: insightsEnabled() });
});
