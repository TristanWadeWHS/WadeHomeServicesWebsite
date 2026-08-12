import {
  getCalendarEventCountForLead,
  getCalendarEventForVerification,
  getLeadById,
  verifyCalendarBusyWindow,
} from "@/app/lib/booking/google";
import { isOwnerAuthorized } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return verifyRequest(request, {
    leadId: url.searchParams.get("leadId") ?? "",
    eventId: url.searchParams.get("eventId") ?? "",
    timeMin: url.searchParams.get("timeMin") ?? "",
    timeMax: url.searchParams.get("timeMax") ?? "",
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  return verifyRequest(request, {
    leadId: String(form.get("leadId") ?? ""),
    eventId: String(form.get("eventId") ?? ""),
    timeMin: String(form.get("timeMin") ?? ""),
    timeMax: String(form.get("timeMax") ?? ""),
  });
}

async function verifyRequest(
  request: Request,
  input: { leadId: string; eventId: string; timeMin: string; timeMax: string },
) {
  if (process.env.VERCEL_ENV !== "preview") {
    return jsonError("Verification is only available in Preview.", 404);
  }
  if (!isOwnerAuthorized(request)) return jsonError("Unauthorized.", 401);

  const { leadId, eventId, timeMin, timeMax } = input;
  if (!leadId) return jsonError("Lead ID is required.", 400);

  try {
    const lead = await getLeadById(leadId);
    const event = eventId ? await getCalendarEventForVerification(eventId) : null;
    const busy =
      timeMin && timeMax ? await verifyCalendarBusyWindow(timeMin, timeMax) : null;
    const eventCount =
      timeMin && timeMax
        ? await getCalendarEventCountForLead(leadId, timeMin, timeMax)
        : null;

    return Response.json({
      ok: true,
      lead: lead
        ? {
            leadId: lead.leadId,
            status: lead.status,
            source: lead.source,
            requestedDate: lead.requestedDate,
            requestedTime: lead.requestedTime,
            decisionTimestamp: lead.decisionTimestamp,
            calendarEventId: lead.calendarEventId,
            confirmedDate: lead.confirmedDate,
            confirmedTime: lead.confirmedTime,
            declineReason: lead.declineReason,
            emailStatus: lead.emailStatus,
          }
        : null,
      event,
      busy,
      eventCount,
    });
  } catch (error) {
    logServerError("owner.verification", error, { leadId });
    return jsonError("Verification could not be completed.", 503);
  }
}
