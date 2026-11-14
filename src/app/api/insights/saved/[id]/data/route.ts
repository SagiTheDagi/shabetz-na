import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";
import { ensureInsightsSchema } from "@/lib/insights/views";
import { ToolError } from "@/lib/insights/errors";
import { insightsEnabled, NOT_CONFIGURED_MESSAGE } from "@/lib/insights/config";
import { getReadonlyDb } from "@/lib/insights/readonly-db";
import { getSavedView, rerunSavedView, OutdatedViewError, OUTDATED_MESSAGE } from "@/lib/insights/saved";

export const runtime = "nodejs";

/**
 * Re-runs the saved source without the LLM: free and current. 409 when the
 * view no longer matches the data shape. The request's signal kills an SQL
 * child process when the client leaves.
 */
export const GET = withApiErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  if (!insightsEnabled()) return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  ensureInsightsSchema();
  const { id } = await params;
  const view = getSavedView(getDb(), id);
  if (!view) return NextResponse.json({ error: "התצוגה לא נמצאה" }, { status: 404 });
  try {
    return NextResponse.json(await rerunSavedView(view, { db: getReadonlyDb(), signal: req.signal }));
  } catch (e) {
    if (e instanceof OutdatedViewError) {
      console.error(`[insights] saved view ${id} outdated:`, e.message);
      return NextResponse.json({ error: OUTDATED_MESSAGE }, { status: 409 });
    }
    if (e instanceof ToolError) {
      console.error(`[insights] saved view ${id} re-run failed:`, e.message); // English detail stays in the log
      return NextResponse.json({ error: "טעינת נתוני התצוגה נכשלה" }, { status: 422 });
    }
    throw e;
  }
});
