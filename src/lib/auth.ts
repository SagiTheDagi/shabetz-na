import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcrypt";
import { cookies } from "next/headers";
import type { SessionPayload } from "./types";

const COOKIE_NAME = "shabetz_session";
const SESSION_TTL = 60 * 60 * 24; // 24 hours in seconds

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return new TextEncoder().encode("fallback-dev-secret");
  return new TextEncoder().encode(secret);
}

function getPepper(): string {
  return process.env.PEPPER_SECRET || "";
}

// --- Password ---

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(getPepper() + plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(getPepper() + plain, hash);
}

// --- Session ---

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(getSessionSecret());
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// --- Rate Limiting ---

const loginAttempts = new Map<
  string,
  { count: number; lockedUntil: number }
>();

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export function checkRateLimit(workerId: string): {
  allowed: boolean;
  remainingMs?: number;
} {
  const entry = loginAttempts.get(workerId);
  if (!entry) return { allowed: true };

  if (entry.lockedUntil > Date.now()) {
    return {
      allowed: false,
      remainingMs: entry.lockedUntil - Date.now(),
    };
  }

  if (entry.lockedUntil <= Date.now() && entry.count >= MAX_ATTEMPTS) {
    loginAttempts.delete(workerId);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordFailedLogin(workerId: string): void {
  const entry = loginAttempts.get(workerId) || {
    count: 0,
    lockedUntil: 0,
  };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(workerId, entry);
}

export function clearLoginAttempts(workerId: string): void {
  loginAttempts.delete(workerId);
}
