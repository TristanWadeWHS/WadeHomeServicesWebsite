import { closeLead } from "@/app/lib/booking/google";
import { isSameOriginRequest, requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-close:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many close attempts.", 429);
  if (!requestBodyWithinLimit(request, 12 * 1024)) return jsonError("Request is too large.", 413);

  const form = await request.formData();
  const leadId = String(form.get("leadId") ?? "");
  const reason = String(form.get("reason") ?? "");
  const note = String(form.get("note") ?? "");
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);
  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);
  if (!leadId) return jsonError("Lead ID is required.", 400);

  try {
    const result = await closeLead(leadId, { reason, note }, authorization.user.label);
    if (!result.ok) return jsonError(result.message, 409, { lead: result.lead });
    return Response.json(result);
  } catch (error) {
    logServerError("owner.close", error, { ip, leadId });
    return jsonError("Request could not be closed safely.", 503);
  }
}
