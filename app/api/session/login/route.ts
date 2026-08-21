import {
  createOperationsSession,
  createOwnerSession,
  isSameOriginRequest,
  operationsSessionActiveCookieOptions,
  operationsSessionCookieOptions,
  OPERATIONS_SESSION_ACTIVE_COOKIE,
  OPERATIONS_SESSION_COOKIE,
  ownerSessionActiveCookieOptions,
  ownerSessionCookieOptions,
  OWNER_SESSION_ACTIVE_COOKIE,
  OWNER_SESSION_COOKIE,
  ROLE_OWNER,
  roleForToken,
} from "@/app/lib/booking/ownerAuth";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`operations-login:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) return redirectToLogin(request);
  if (!isSameOriginRequest(request)) return redirectToLogin(request);
  if (!requestBodyWithinLimit(request, 4 * 1024)) return redirectToLogin(request);

  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const user = roleForToken(token);
  if (!user) return redirectToLogin(request);

  const response = redirectToLogin(request);
  response.cookies.set(
    OPERATIONS_SESSION_COOKIE,
    createOperationsSession(user),
    operationsSessionCookieOptions(),
  );
  response.cookies.set(
    OPERATIONS_SESSION_ACTIVE_COOKIE,
    "1",
    operationsSessionActiveCookieOptions(),
  );

  if (user.role === ROLE_OWNER) {
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
  }

  return response;
}

function redirectToLogin(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
