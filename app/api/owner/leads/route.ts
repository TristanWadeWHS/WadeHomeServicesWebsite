import { appendManualLeadToSheet } from "@/app/lib/booking/google";
import { isSameOriginRequest, requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, readJsonWithLimit } from "@/app/lib/booking/security";
import { createLeadId, validateManualLeadInput } from "@/app/lib/booking/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-lead-create:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many lead creation attempts.", 429);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const body = await readJsonWithLimit(request, 16 * 1024);
  if (!body.ok) return jsonError(body.message, body.status);

  const result = validateManualLeadInput(body.value);
  if (!result.ok) return jsonError("Lead could not be created.", 400, result.errors);

  const leadId = createLeadId();
  try {
    const lead = await appendManualLeadToSheet(leadId, result.value);
    return Response.json({ ok: true, lead });
  } catch (error) {
    logServerError("owner.leads.create", error, { ip });
    return jsonError("Lead could not be saved.", 503);
  }
}
