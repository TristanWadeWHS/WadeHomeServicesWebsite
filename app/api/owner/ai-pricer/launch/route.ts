import { NextResponse } from "next/server";
import {
  aiPricerExchangeUrl,
  aiPricerIntegrationConfigured,
  createAiPricerAssertion,
} from "@/app/lib/booking/aiPricerSso";
import { requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";

export async function GET(request: Request) {
  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, message: authorization.message },
      { status: authorization.status },
    );
  }

  if (!aiPricerIntegrationConfigured()) {
    return NextResponse.json(
      { ok: false, message: "AI Pricer integration is not configured." },
      { status: 503 },
    );
  }

  try {
    const exchangeUrl = aiPricerExchangeUrl();
    const assertion = createAiPricerAssertion();
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Opening AI Pricer</title>
  </head>
  <body>
    <main>
      <p>Opening the secure AI Pricer...</p>
      <form id="ai-pricer-handoff" action="${escapeHtml(exchangeUrl.toString())}" method="post">
        <input name="assertion" type="hidden" value="${escapeHtml(assertion)}">
        <button type="submit">Continue to AI Pricer</button>
      </form>
    </main>
    <script>document.getElementById('ai-pricer-handoff').submit();</script>
  </body>
</html>`;

    return new NextResponse(html, {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": [
          "default-src 'none'",
          "base-uri 'none'",
          `form-action ${exchangeUrl.origin}`,
          "frame-ancestors 'none'",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'",
        ].join("; "),
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      },
      status: 200,
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "AI Pricer could not be opened." },
      { status: 503 },
    );
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}
