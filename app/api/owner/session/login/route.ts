import {
  createOwnerSession,
  isValidOwnerToken,
  OWNER_SESSION_COOKIE,
  ownerSessionCookieOptions,
} from "@/app/lib/booking/ownerAuth";
import { clientIp, rateLimit } from "@/app/lib/booking/security";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-login:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) return redirectToApprovals(request);

  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  if (!isValidOwnerToken(token)) return redirectToApprovals(request);

  const response = redirectToApprovals(request);
  response.cookies.set(
    OWNER_SESSION_COOKIE,
    createOwnerSession(),
    ownerSessionCookieOptions(),
  );
  return response;
}

function redirectToApprovals(request: Request) {
  return NextResponse.redirect(new URL("/owner/approvals", request.url), 303);
}
