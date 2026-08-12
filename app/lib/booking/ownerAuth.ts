import { createHmac, timingSafeEqual } from "node:crypto";

export const OWNER_SESSION_COOKIE = "whs_owner_session";
const OWNER_SESSION_VERSION = "v1";
const OWNER_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const revokedSessions = new Map<string, number>();

export function ownerApprovalConfigured() {
  return Boolean(process.env.OWNER_APPROVAL_TOKEN);
}

export function isOwnerAuthorized(request: Request) {
  const session = extractOwnerSession(request);
  return isValidOwnerSession(session);
}

export function isValidOwnerToken(token: string | null | undefined) {
  const expected = process.env.OWNER_APPROVAL_TOKEN;
  if (!expected || !token) return false;
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, tokenBuffer);
}

export function createOwnerSession(now = Date.now()) {
  const expected = process.env.OWNER_APPROVAL_TOKEN;
  if (!expected) throw new Error("OWNER_APPROVAL_TOKEN is not configured.");
  const issuedAt = String(now);
  const payload = `${OWNER_SESSION_VERSION}.${issuedAt}`;
  return `${payload}.${signOwnerSession(payload, expected)}`;
}

export function isValidOwnerSession(session: string | null | undefined, now = Date.now()) {
  const expected = process.env.OWNER_APPROVAL_TOKEN;
  if (!expected || !session) return false;

  const parts = session.split(".");
  if (parts.length !== 3 || parts[0] !== OWNER_SESSION_VERSION) return false;
  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (issuedAt > now + 60_000) return false;
  if (now - issuedAt > OWNER_SESSION_MAX_AGE_SECONDS * 1000) return false;
  if (isRevoked(session, now)) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expectedSignature = signOwnerSession(payload, expected);
  const providedSignature = parts[2];
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function ownerSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "strict" as const,
    secure: true,
  };
}

export function clearedOwnerSessionCookieOptions() {
  return {
    ...ownerSessionCookieOptions(),
    maxAge: 0,
  };
}

export function revokeOwnerSession(session: string | null | undefined, now = Date.now()) {
  if (!session) return;
  revokedSessions.set(session, now + OWNER_SESSION_MAX_AGE_SECONDS * 1000);
}

export function getOwnerSessionFromRequest(request: Request) {
  return extractOwnerSession(request);
}

function extractOwnerSession(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const sessionCookie = cookies.find((cookie) =>
    cookie.startsWith(`${OWNER_SESSION_COOKIE}=`),
  );
  return sessionCookie
    ? decodeURIComponent(sessionCookie.slice(OWNER_SESSION_COOKIE.length + 1))
    : null;
}

function isRevoked(session: string, now: number) {
  for (const [revokedSession, expiresAt] of revokedSessions) {
    if (expiresAt <= now) revokedSessions.delete(revokedSession);
  }
  return revokedSessions.has(session);
}

function signOwnerSession(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`wade-home-services-owner-session.${payload}`)
    .digest("base64url");
}
