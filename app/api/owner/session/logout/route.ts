import {
  clearedOwnerSessionCookieOptions,
  getOwnerSessionFromRequest,
  OWNER_SESSION_COOKIE,
  revokeOwnerSession,
} from "@/app/lib/booking/ownerAuth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  revokeOwnerSession(getOwnerSessionFromRequest(request));
  const response = NextResponse.redirect(new URL("/owner/approvals", request.url), 303);
  response.cookies.set(OWNER_SESSION_COOKIE, "", clearedOwnerSessionCookieOptions());
  return response;
}
