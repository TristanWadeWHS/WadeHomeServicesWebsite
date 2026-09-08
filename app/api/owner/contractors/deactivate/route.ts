import { isSameOriginRequest, requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";
import { deactivateContractorAccount } from "@/app/lib/contractors/database";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-contractor-deactivate:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many contractor account changes.", 429);
  if (!requestBodyWithinLimit(request, 8 * 1024)) return jsonError("Request is too large.", 413);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const form = await request.formData();
  const contractorId = String(form.get("contractorId") ?? "");
  if (!contractorId) return jsonError("Contractor ID is required.", 400);

  try {
    const result = await deactivateContractorAccount(contractorId, authorization.user.label);
    if (!result.ok) return jsonError(result.message, result.status);
    return Response.json({ ok: true, contractor: result.account });
  } catch (error) {
    logServerError("owner.contractors.deactivate", error, { ip, contractorId });
    return jsonError("Contractor account could not be deactivated.", 503);
  }
}
