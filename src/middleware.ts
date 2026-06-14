import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "shabetz_session";

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return new TextEncoder().encode("fallback-dev-secret");
  return new TextEncoder().encode(secret);
}

async function getSessionFromRequest(
  req: NextRequest
): Promise<{ worker_id: string; name: string; is_admin: boolean } | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as {
      worker_id: string;
      name: string;
      is_admin: boolean;
    };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes
  if (
    pathname === "/" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequest(req);

  // Worker routes
  if (pathname.startsWith("/worker")) {
    if (!session) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // Admin routes
  if (pathname.startsWith("/admin")) {
    if (!session || !session.is_admin) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // Admin-only API routes
  const adminApiPrefixes = [
    "/api/workers",
    "/api/assignments",
    "/api/shifts",
    "/api/ranks",
    "/api/shift-types",
    "/api/eligibility",
    "/api/export",
    "/api/quarters",
  ];

  for (const prefix of adminApiPrefixes) {
    if (pathname.startsWith(prefix)) {
      if (!session || !session.is_admin) {
        return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
      }
      return NextResponse.next();
    }
  }

  // Availability API — worker must be logged in
  if (pathname.startsWith("/api/availability")) {
    if (!session) {
      return NextResponse.json(
        { error: "נדרשת התחברות" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
