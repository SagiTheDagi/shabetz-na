import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";
import { ensureInsightsSchema } from "@/lib/insights/views";
import { ToolError } from "@/lib/insights/errors";
import { insightsEnabled, NOT_CONFIGURED_MESSAGE } from "@/lib/insights/config";
import { getReadonlyDb } from "@/lib/insights/readonly-db";
import { createSavedView, listSavedViews, saveRequestSchema, OutdatedViewError } from "@/lib/insights/saved";

export const runtime = "nodejs";

/** Shared list of saved views (all admins). */
export const GET = withApiErrors(async () => {
  await requireAdmin();
  if (!insightsEnabled()) return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  ensureInsightsSchema();
  return NextResponse.json(listSavedViews(getDb()));
});

/** Save a chart/table spec (without data) + its source. The source is run once to check the spec renders. */
export const POST = withApiErrors(async (req: Request) => {
  const session = await requireAdmin();
  if (!insightsEnabled()) return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  ensureInsightsSchema();
  const body = await req.json().catch(() => null);
  const parsed = saveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "נתוני התצוגה אינם תקינים" }, { status: 400 });
  }
  try {
    const view = await createSavedView(getDb(), parsed.data, session.worker_id, { db: getReadonlyDb(), signal: req.signal });
    return NextResponse.json(view, { status: 201 });
  } catch (e) {
    if (e instanceof ToolError || e instanceof OutdatedViewError) {
      console.error("[insights] saved view rejected:", e.message);
      return NextResponse.json({ error: "מקור הנתונים של התצוגה אינו תקין" }, { status: 400 });
    }
    throw e;
  }
});
