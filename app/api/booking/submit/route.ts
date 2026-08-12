import {
  appendLeadToSheet,
  getCalendarBusyWindows,
  googleConfigured,
} from "@/app/lib/booking/google";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { isSlotStillAvailable } from "@/app/lib/booking/scheduling";
import {
  clientIp,
  duplicateFingerprint,
  getIdempotentResponse,
  isLikelyDuplicate,
  rateLimit,
  setIdempotentResponse,
  verifyTurnstile,
} from "@/app/lib/booking/security";
import { createLeadId, validateSubmission } from "@/app/lib/booking/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`submit:${ip}`, 6, 30 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many submission attempts. Try again soon.", 429);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request could not be read.", 400);
  }

  const validation = validateSubmission(body);
  if (!validation.ok) return jsonError("Please fix the highlighted fields.", 400, validation.errors);

  const lead = validation.value;
  const cached = getIdempotentResponse(lead.idempotencyKey);
  if (cached) return Response.json(cached);

  const turnstile = await verifyTurnstile(lead.turnstileToken, ip);
  if (!turnstile.ok) return jsonError("Bot verification failed. Please try again.", 403);

  const fingerprint = duplicateFingerprint([
    lead.normalizedEmail,
    lead.normalizedPhone,
    lead.normalizedAddress.street,
    lead.normalizedAddress.zip,
    lead.projectDescription,
  ]);
  if (isLikelyDuplicate(fingerprint)) {
    return jsonError("This request looks like a recent duplicate.", 409);
  }

  if (!googleConfigured()) {
    return jsonError(
      "Booking integrations are not configured yet. Please call Wade Home Services.",
      503,
    );
  }

  const leadId = createLeadId();
  try {
    const busy = await getCalendarBusyWindows(
      lead.requestedSlot.start,
      lead.requestedSlot.end,
    );
    if (!isSlotStillAvailable(lead.requestedSlot.start, lead.requestedSlot.end, busy)) {
      return jsonError("That time is no longer available. Please choose another.", 409);
    }

    await appendLeadToSheet(leadId, lead);
    const response = {
      ok: true,
      leadId,
      requestedTime: lead.requestedSlot.label,
      pending: true,
    };
    setIdempotentResponse(lead.idempotencyKey, response);
    return Response.json(response);
  } catch (error) {
    logServerError("booking.submit", error, { ip, leadId });
    return jsonError(
      "We could not save your request right now. Please try again or call Wade Home Services.",
      503,
    );
  }
}
