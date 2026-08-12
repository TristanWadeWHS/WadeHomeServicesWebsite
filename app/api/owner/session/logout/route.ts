import {
  clearedOwnerSessionActiveCookieOptions,
  clearedOwnerSessionCookieOptions,
  getOwnerSessionFromRequest,
  isSameOriginRequest,
  OWNER_SESSION_ACTIVE_COOKIE,
  OWNER_SESSION_COOKIE,
  revokeOwnerSession,
} from "@/app/lib/booking/ownerAuth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.redirect(new URL("/owner/approvals", request.url), 303);
  }
  revokeOwnerSession(getOwnerSessionFromRequest(request));
  const response = NextResponse.redirect(new URL("/owner/approvals", request.url), 303);
  response.cookies.set(OWNER_SESSION_COOKIE, "", clearedOwnerSessionCookieOptions());
  response.cookies.set(
    OWNER_SESSION_ACTIVE_COOKIE,
    "",
    clearedOwnerSessionActiveCookieOptions(),
  );
  return response;
}
