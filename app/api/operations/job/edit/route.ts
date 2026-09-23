import { updateActiveJobField, type JobEditField } from "@/app/lib/booking/google";
import { isSameOriginRequest, requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";

export const runtime = "nodejs";

const editableFields = new Set<JobEditField>([
  "name",
  "phone",
  "email",
  "streetAddress",
  "city",
  "state",
  "zip",
  "accessNotes",
  "services",
  "appointmentType",
  "projectDescription",
  "businessOwner",
  "approvedAmount",
  "internalNotes",
]);

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`operations-edit:${ip}`, 40, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many job edit attempts.", 429);
  if (!requestBodyWithinLimit(request, 20 * 1024)) return jsonError("Request is too large.", 413);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const form = await request.formData();
  const leadId = String(form.get("leadId") ?? "");
  const field = String(form.get("field") ?? "") as JobEditField;
  const value = String(form.get("value") ?? "");
  if (!leadId) return jsonError("Lead ID is required.", 400);
  if (!editableFields.has(field)) return jsonError("This field cannot be edited.", 400);

  try {
    const result = await updateActiveJobField(leadId, field, value, authorization.user.label);
    if (!result.ok) return jsonError(result.message, 409, { lead: result.lead });
    return Response.json(result);
  } catch (error) {
    logServerError("operations.edit", error, { ip, leadId, field });
    return jsonError("Job details could not be updated safely.", 503);
  }
}
