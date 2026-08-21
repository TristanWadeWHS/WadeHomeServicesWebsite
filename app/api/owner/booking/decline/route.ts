import { declineLead } from "@/app/lib/booking/google";
import { isSameOriginRequest, requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-decline:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many decline attempts.", 429);
  if (!requestBodyWithinLimit(request, 10 * 1024)) return jsonError("Request is too large.", 413);

  const form = await request.formData();
  const leadId = String(form.get("leadId") ?? "");
  const reason = String(form.get("reason") ?? "");
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);
  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);
  if (!leadId) return jsonError("Lead ID is required.", 400);

  try {
    const result = await declineLead(leadId, reason, authorization.user.label);
    if (!result.ok) return jsonError(result.message, 409, { lead: result.lead });
    return Response.json(result);
  } catch (error) {
    logServerError("owner.decline", error, { ip, leadId });
    return jsonError("Decline could not be completed safely.", 503);
  }
}
