import {
  clearedOperationsSessionActiveCookieOptions,
  clearedOperationsSessionCookieOptions,
  clearedOwnerSessionActiveCookieOptions,
  clearedOwnerSessionCookieOptions,
  getOperationsSessionFromRequest,
  getOwnerSessionFromRequest,
  isSameOriginRequest,
  OPERATIONS_SESSION_ACTIVE_COOKIE,
  OPERATIONS_SESSION_COOKIE,
  OWNER_SESSION_ACTIVE_COOKIE,
  OWNER_SESSION_COOKIE,
  revokeOperationsSession,
  revokeOwnerSession,
} from "@/app/lib/booking/ownerAuth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }
  revokeOperationsSession(getOperationsSessionFromRequest(request));
  revokeOwnerSession(getOwnerSessionFromRequest(request));

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(OPERATIONS_SESSION_COOKIE, "", clearedOperationsSessionCookieOptions());
  response.cookies.set(
    OPERATIONS_SESSION_ACTIVE_COOKIE,
    "",
    clearedOperationsSessionActiveCookieOptions(),
  );
  response.cookies.set(OWNER_SESSION_COOKIE, "", clearedOwnerSessionCookieOptions());
  response.cookies.set(
    OWNER_SESSION_ACTIVE_COOKIE,
    "",
    clearedOwnerSessionActiveCookieOptions(),
  );
  return response;
}
