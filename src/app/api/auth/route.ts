import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  checkRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
} from "@/lib/auth";
import type { Worker, SessionPayload } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { worker_id, password } = body as {
    worker_id?: string;
    password?: string;
  };

  if (!worker_id || typeof worker_id !== "string" || worker_id.length > 50) {
    return NextResponse.json(
      { error: "מספר עובד לא תקין" },
      { status: 400 }
    );
  }

  // Rate limiting
  const rateCheck = checkRateLimit(worker_id);
  if (!rateCheck.allowed) {
    const minutes = Math.ceil((rateCheck.remainingMs || 0) / 60000);
    return NextResponse.json(
      { error: `יותר מדי ניסיונות. נסה שוב בעוד ${minutes} דקות` },
      { status: 429 }
    );
  }

  const db = getDb();
  const worker = db
    .prepare("SELECT * FROM Worker WHERE worker_id = ?")
    .get(worker_id) as Worker | undefined;

  if (!worker) {
    recordFailedLogin(worker_id);
    return NextResponse.json(
      { error: "מספר עובד לא נמצא" },
      { status: 401 }
    );
  }

  // Admin requires password
  if (worker.is_admin) {
    if (!password) {
      return NextResponse.json(
        { error: "נדרשת סיסמה", requiresPassword: true },
        { status: 401 }
      );
    }

    if (!worker.password_hash) {
      return NextResponse.json(
        { error: "שגיאת מערכת — אין סיסמה מוגדרת למנהל" },
        { status: 500 }
      );
    }

    const valid = await verifyPassword(password, worker.password_hash);
    if (!valid) {
      recordFailedLogin(worker_id);
      return NextResponse.json({ error: "סיסמה שגויה" }, { status: 401 });
    }
  }

  clearLoginAttempts(worker_id);

  const payload: SessionPayload = {
    worker_id: worker.worker_id,
    name: worker.name,
    is_admin: !!worker.is_admin,
  };

  const token = await createSession(payload);
  await setSessionCookie(token);

  return NextResponse.json({
    worker_id: worker.worker_id,
    name: worker.name,
    is_admin: !!worker.is_admin,
  });
}

export async function DELETE() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }
  return NextResponse.json(session);
}
