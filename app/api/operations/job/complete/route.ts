import { completeJob } from "@/app/lib/booking/google";
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
  const limit = rateLimit(`operations-complete:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many completion attempts.", 429);
  if (!requestBodyWithinLimit(request, 20 * 1024)) return jsonError("Request is too large.", 413);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);
  const authorization = requireAnyRole(request, [ROLE_OWNER, ROLE_FIELD_MANAGER]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const form = await request.formData();
  const leadId = String(form.get("leadId") ?? "");
  if (!leadId) return jsonError("Lead ID is required.", 400);

  try {
    const result = await completeJob(
      leadId,
      {
        finalAmount: String(form.get("finalAmount") ?? ""),
        projectCosts: String(form.get("projectCosts") ?? ""),
        distance: String(form.get("distance") ?? ""),
        notes: String(form.get("notes") ?? ""),
      },
      authorization.user.label,
    );
    if (!result.ok) return jsonError(result.message, 409, { lead: result.lead });
    return Response.json(result);
  } catch (error) {
    logServerError("operations.complete", error, { ip, leadId });
    return jsonError("Job completion could not be transferred safely.", 503);
  }
}
