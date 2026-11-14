import { requireRole, ROLE_OWNER, isSameOriginRequest } from "../../../../lib/booking/ownerAuth";
import { latestDigestReceipt } from "../../../../lib/command-center/digest-store";
import { sendDailyDigest } from "../../../../lib/command-center/send-digest";
import { digestRecipients } from "../../../../lib/command-center/digest";
import { CommandCenterError } from "../../../../lib/command-center/store";

export const maxDuration = 60;
const json = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function authorize(request: Request) {
  const auth = requireRole(request, ROLE_OWNER);
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status);
  if (request.method !== "GET" && !isSameOriginRequest(request)) return json({ ok: false, message: "Forbidden." }, 403);
}
export async function GET(request: Request) {
  const denied = authorize(request); if (denied) return denied;
  try {
    let recipientCount = 0;
    try { recipientCount = digestRecipients().length; } catch { /* Show configuration status without exposing addresses. */ }
    return json({ ok: true, configured: Boolean(process.env.CRON_SECRET && process.env.BREVO_API_KEY && recipientCount), recipientCount, schedule: "Daily at 8 AM Pacific", latestReceipt: await latestDigestReceipt() });
  } catch { return json({ ok: false, message: "Could not read daily digest status." }, 503); }
}
export async function POST(request: Request) {
  const denied = authorize(request); if (denied) return denied;
  try { return json({ ok: true, ...await sendDailyDigest() }); }
  catch (error) {
    console.error("command-center.digest.manual", { status: error instanceof CommandCenterError ? error.status : 503 });
    return json({ ok: false, message: error instanceof CommandCenterError ? error.message : "Could not send the daily digest." }, error instanceof CommandCenterError ? error.status : 503);
  }
}
