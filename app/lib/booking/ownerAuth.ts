import { timingSafeEqual } from "node:crypto";

export function ownerApprovalConfigured() {
  return Boolean(process.env.OWNER_APPROVAL_TOKEN);
}

export function isOwnerAuthorized(request: Request) {
  const token = extractOwnerToken(request);
  return isValidOwnerToken(token);
}

export function isValidOwnerToken(token: string | null | undefined) {
  const expected = process.env.OWNER_APPROVAL_TOKEN;
  if (!expected || !token) return false;
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, tokenBuffer);
}

export function extractOwnerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const url = new URL(request.url);
  return url.searchParams.get("token");
}
