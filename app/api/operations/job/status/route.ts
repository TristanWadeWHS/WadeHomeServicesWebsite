import { updateJobStatus } from "@/app/lib/booking/google";
import {
  isSameOriginRequest,
  requireAnyRole,
  ROLE_FIELD_MANAGER,
  ROLE_OWNER,
} from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`operations-status:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many status update attempts.", 429);
  if (!requestBodyWithinLimit(request, 10 * 1024)) return jsonError("Request is too large.", 413);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);
  const authorization = requireAnyRole(request, [ROLE_OWNER, ROLE_FIELD_MANAGER]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const form = await request.formData();
  const leadId = String(form.get("leadId") ?? "");
  const status = String(form.get("status") ?? "");
  if (!leadId) return jsonError("Lead ID is required.", 400);

  try {
    const result = await updateJobStatus(leadId, status as Parameters<typeof updateJobStatus>[1], authorization.user.label);
    if (!result.ok) return jsonError(result.message, 409, { lead: result.lead });
    return Response.json(result);
  } catch (error) {
    logServerError("operations.status", error, { ip, leadId });
    return jsonError("Job status could not be updated safely.", 503);
  }
}
