import {
  createOwnerSession,
  OWNER_SESSION_ACTIVE_COOKIE,
  isSameOriginRequest,
  isValidOwnerToken,
  OWNER_SESSION_COOKIE,
  ownerSessionActiveCookieOptions,
  ownerSessionCookieOptions,
} from "@/app/lib/booking/ownerAuth";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-login:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) return redirectToOwner(request);
  if (!isSameOriginRequest(request)) return redirectToOwner(request);
  if (!requestBodyWithinLimit(request, 4 * 1024)) return redirectToOwner(request);

  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  if (!isValidOwnerToken(token)) return redirectToOwner(request);

  const response = redirectToOwner(request);
  response.cookies.set(
    OWNER_SESSION_COOKIE,
    createOwnerSession(),
    ownerSessionCookieOptions(),
  );
  response.cookies.set(
    OWNER_SESSION_ACTIVE_COOKIE,
    "1",
    ownerSessionActiveCookieOptions(),
  );
  return response;
}

function redirectToOwner(request: Request) {
  return NextResponse.redirect(new URL("/owner", request.url), 303);
}
