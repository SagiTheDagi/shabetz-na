import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";
import { ensureInsightsSchema } from "@/lib/insights/views";
import { insightsEnabled, NOT_CONFIGURED_MESSAGE } from "@/lib/insights/config";
import { deleteSavedView } from "@/lib/insights/saved";

/** Any admin may delete any saved view. */
export const DELETE = withApiErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  if (!insightsEnabled()) return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  ensureInsightsSchema();
  const { id } = await params;
  if (!deleteSavedView(getDb(), id)) {
    return NextResponse.json({ error: "התצוגה לא נמצאה" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
