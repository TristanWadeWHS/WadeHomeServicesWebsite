import { createHmac, timingSafeEqual } from "node:crypto";

export const OWNER_SESSION_COOKIE = "whs_owner_session";
export const OWNER_SESSION_ACTIVE_COOKIE = "whs_owner_session_active";
export const OPERATIONS_SESSION_COOKIE = "whs_operations_session";
export const OPERATIONS_SESSION_ACTIVE_COOKIE = "whs_operations_session_active";

export const ROLE_OWNER = "OWNER";
export const ROLE_FIELD_MANAGER = "FIELD_MANAGER";
export type OperationsRole = typeof ROLE_OWNER | typeof ROLE_FIELD_MANAGER;
export type OperationsUser = {
  role: OperationsRole;
  label: string;
};

const OWNER_SESSION_VERSION = "v1";
const OPERATIONS_SESSION_VERSION = "v2";
const OWNER_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const revokedSessions = new Map<string, number>();

export function ownerApprovalConfigured() {
  return Boolean(process.env.OWNER_APPROVAL_TOKEN);
}

export function operationsAuthConfigured() {
  return Boolean(process.env.OWNER_APPROVAL_TOKEN && process.env.FIELD_MANAGER_ACCESS_TOKEN);
}

export function isOwnerAuthorized(request: Request) {
  return requireRole(request, ROLE_OWNER).ok;
}

export function getAuthorizedOperationsUser(request: Request): OperationsUser | null {
  const session = extractCookie(request, OPERATIONS_SESSION_COOKIE);
  const active = extractCookie(request, OPERATIONS_SESSION_ACTIVE_COOKIE) === "1";
  if (active) {
    const user = verifyOperationsSession(session);
    if (user) return user;
  }

  const ownerSession = extractOwnerSession(request);
  if (hasActiveOwnerSessionMarker(request) && isValidOwnerSession(ownerSession)) {
    return { role: ROLE_OWNER, label: "Owner" };
  }

  return null;
}

export function requireRole(request: Request, role: OperationsRole) {
  const user = getAuthorizedOperationsUser(request);
  if (!user) return { ok: false as const, status: 401, message: "Unauthorized." };
  if (user.role !== role) return { ok: false as const, status: 403, message: "Forbidden." };
  return { ok: true as const, user };
}

export function requireAnyRole(request: Request, roles: OperationsRole[]) {
  const user = getAuthorizedOperationsUser(request);
  if (!user) return { ok: false as const, status: 401, message: "Unauthorized." };
  if (!roles.includes(user.role)) {
    return { ok: false as const, status: 403, message: "Forbidden." };
  }
  return { ok: true as const, user };
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export function isValidOwnerToken(token: string | null | undefined) {
  return isValidRoleToken(token, ROLE_OWNER);
}

export function isValidRoleToken(token: string | null | undefined, role: OperationsRole) {
  const expected = tokenForRole(role);
  if (!expected || !token) return false;
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, tokenBuffer);
}

export function roleForToken(token: string | null | undefined): OperationsUser | null {
  if (isValidRoleToken(token, ROLE_OWNER)) return { role: ROLE_OWNER, label: "Owner" };
  if (isValidRoleToken(token, ROLE_FIELD_MANAGER)) {
    return { role: ROLE_FIELD_MANAGER, label: "Field Manager" };
  }
  return null;
}

export function createOwnerSession(now = Date.now()) {
  const expected = process.env.OWNER_APPROVAL_TOKEN;
  if (!expected) throw new Error("OWNER_APPROVAL_TOKEN is not configured.");
  const issuedAt = String(now);
  const payload = `${OWNER_SESSION_VERSION}.${issuedAt}`;
  return `${payload}.${signOwnerSession(payload, expected)}`;
}

export function createOperationsSession(user: OperationsUser, now = Date.now()) {
  const signingSecret = operationsSigningSecret();
  const issuedAt = String(now);
  const payload = `${OPERATIONS_SESSION_VERSION}.${user.role}.${issuedAt}`;
  return `${payload}.${signOperationsSession(payload, signingSecret)}`;
}

export function isValidOwnerSession(session: string | null | undefined, now = Date.now()) {
  const expected = process.env.OWNER_APPROVAL_TOKEN;
  if (!expected || !session) return false;

  const parts = session.split(".");
  if (parts.length !== 3 || parts[0] !== OWNER_SESSION_VERSION) return false;
  const issuedAt = Number(parts[1]);
  if (!validIssuedAt(issuedAt, now)) return false;
  if (isRevoked(session, now)) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  return signaturesMatch(signOwnerSession(payload, expected), parts[2]);
}

export function verifyOperationsSession(session: string | null | undefined, now = Date.now()) {
  if (!session) return null;
  const signingSecret = operationsSigningSecret();
  if (!signingSecret) return null;

  const parts = session.split(".");
  if (parts.length !== 4 || parts[0] !== OPERATIONS_SESSION_VERSION) return null;
  const role = parts[1] as OperationsRole;
  if (role !== ROLE_OWNER && role !== ROLE_FIELD_MANAGER) return null;
  const issuedAt = Number(parts[2]);
  if (!validIssuedAt(issuedAt, now)) return null;
  if (isRevoked(session, now)) return null;

  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  if (!signaturesMatch(signOperationsSession(payload, signingSecret), parts[3])) return null;
  return { role, label: role === ROLE_OWNER ? "Owner" : "Field Manager" };
}

export function ownerSessionCookieOptions() {
  return sessionCookieOptions();
}

export function ownerSessionActiveCookieOptions() {
  return sessionCookieOptions();
}

export function operationsSessionCookieOptions() {
  return sessionCookieOptions();
}

export function operationsSessionActiveCookieOptions() {
  return sessionCookieOptions();
}

export function clearedOwnerSessionCookieOptions() {
  return clearedSessionCookieOptions();
}

export function clearedOwnerSessionActiveCookieOptions() {
  return clearedSessionCookieOptions();
}

export function clearedOperationsSessionCookieOptions() {
  return clearedSessionCookieOptions();
}

export function clearedOperationsSessionActiveCookieOptions() {
  return clearedSessionCookieOptions();
}

export function revokeOwnerSession(session: string | null | undefined, now = Date.now()) {
  revokeSession(session, now);
}

export function revokeOperationsSession(session: string | null | undefined, now = Date.now()) {
  revokeSession(session, now);
}

export function getOwnerSessionFromRequest(request: Request) {
  return extractOwnerSession(request);
}

export function getOperationsSessionFromRequest(request: Request) {
  return extractCookie(request, OPERATIONS_SESSION_COOKIE);
}

function extractOwnerSession(request: Request) {
  return extractCookie(request, OWNER_SESSION_COOKIE);
}

function hasActiveOwnerSessionMarker(request: Request) {
  return extractCookie(request, OWNER_SESSION_ACTIVE_COOKIE) === "1";
}

function extractCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return sessionCookie
    ? decodeURIComponent(sessionCookie.slice(name.length + 1))
    : null;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "strict" as const,
    secure: true,
  };
}

function clearedSessionCookieOptions() {
  return {
    ...sessionCookieOptions(),
    maxAge: 0,
  };
}

function revokeSession(session: string | null | undefined, now = Date.now()) {
  if (!session) return;
  revokedSessions.set(session, now + OWNER_SESSION_MAX_AGE_SECONDS * 1000);
}

function isRevoked(session: string, now: number) {
  for (const [revokedSession, expiresAt] of revokedSessions) {
    if (expiresAt <= now) revokedSessions.delete(revokedSession);
  }
  return revokedSessions.has(session);
}

function validIssuedAt(issuedAt: number, now: number) {
  if (!Number.isFinite(issuedAt)) return false;
  if (issuedAt > now + 60_000) return false;
  return now - issuedAt <= OWNER_SESSION_MAX_AGE_SECONDS * 1000;
}

function tokenForRole(role: OperationsRole) {
  return role === ROLE_OWNER
    ? process.env.OWNER_APPROVAL_TOKEN
    : process.env.FIELD_MANAGER_ACCESS_TOKEN;
}

function operationsSigningSecret() {
  return [process.env.OWNER_APPROVAL_TOKEN, process.env.FIELD_MANAGER_ACCESS_TOKEN]
    .filter(Boolean)
    .join(".");
}

function signaturesMatch(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function signOwnerSession(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`wade-home-services-owner-session.${payload}`)
    .digest("base64url");
}

function signOperationsSession(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`wade-home-services-operations-session.${payload}`)
    .digest("base64url");
}
