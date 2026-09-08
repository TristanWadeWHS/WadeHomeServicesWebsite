import { appendContractorLeadToSheet } from "@/app/lib/booking/google";
import {
  isSameOriginRequest,
  requireAnyRoleAsync,
  ROLE_CONTRACTOR,
} from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";
import { createLeadId, validateManualLeadInput } from "@/app/lib/booking/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`contractor-lead-create:${ip}`, 12, 10 * 60 * 1000);
  if (!limit.ok) return redirectToLogin(request);
  if (!requestBodyWithinLimit(request, 16 * 1024)) return redirectToLogin(request);
  if (!isSameOriginRequest(request)) return redirectToLogin(request);

  const authorization = await requireAnyRoleAsync(request, [ROLE_CONTRACTOR]);
  if (!authorization.ok) return redirectToLogin(request);

  const form = await request.formData();
  const result = validateManualLeadInput({
    name: form.get("name"),
    opportunityInfo: form.get("opportunityInfo"),
    phone: form.get("phone"),
    email: form.get("email"),
    streetAddress: form.get("streetAddress"),
    city: form.get("city"),
    notes: form.get("notes"),
  });
  if (!result.ok) return redirectToLogin(request);

  try {
    await appendContractorLeadToSheet(createLeadId(), result.value, authorization.user);
    return Response.redirect(new URL("/login?contractorLead=created", request.url), 303);
  } catch (error) {
    logServerError("contractor.leads.create", error, { ip, contractorId: authorization.user.id });
    return jsonError("Lead could not be saved.", 503);
  }
}

function redirectToLogin(request: Request) {
  return Response.redirect(new URL("/login", request.url), 303);
}
