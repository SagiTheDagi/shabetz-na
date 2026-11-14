import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";
import { ensureInsightsSchema } from "@/lib/insights/views";
import { getBudget, currentMonth, MONTHLY_CAP_USD } from "@/lib/insights/budget";
import { insightsEnabled, pseudonymizeEnabled, pseudonymizeMisconfigured } from "@/lib/insights/config";

/** Current month's assistant spend, the cap, and whether the assistant is configured. */
export const GET = withApiErrors(async () => {
  await requireAdmin();
  const month = currentMonth();
  // Hit on every admin page load (nav link): no schema/budget work when unconfigured.
  if (!insightsEnabled()) {
    return NextResponse.json({ month, cost_usd: 0, cap: MONTHLY_CAP_USD, enabled: false, pseudonymize: false });
  }
  // Chat would refuse every request (503): show the setup message instead of a ready UI.
  if (pseudonymizeMisconfigured()) {
    return NextResponse.json({ month, cost_usd: 0, cap: MONTHLY_CAP_USD, enabled: false, pseudonymize: true, misconfigured: "alias_secret" });
  }
  ensureInsightsSchema();
  const cost_usd = getBudget(getDb()).monthCost(month); // InsightUsage exists: ensureInsightsSchema above
  return NextResponse.json({ month, cost_usd, cap: MONTHLY_CAP_USD, enabled: true, pseudonymize: pseudonymizeEnabled() });
});
