import { approveLead } from "@/app/lib/booking/google";
import { isOwnerAuthorized } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit } from "@/app/lib/booking/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-approve:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many approval attempts.", 429);

  const form = await request.formData();
  const leadId = String(form.get("leadId") ?? "");
  if (!isOwnerAuthorized(request)) return jsonError("Unauthorized.", 401);
  if (!leadId) return jsonError("Lead ID is required.", 400);

  try {
    const result = await approveLead(leadId);
    if (!result.ok) return jsonError(result.message, 409, { lead: result.lead });
    return Response.json(result);
  } catch (error) {
    logServerError("owner.approve", error, { ip, leadId });
    return jsonError("Approval could not be completed safely.", 503);
  }
}
