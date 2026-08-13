import {
  appendLeadToSheet,
  getCalendarBusyWindows,
  googleConfigured,
} from "@/app/lib/booking/google";
import { sendOwnerNewLeadNotification } from "@/app/lib/booking/ownerNotifications";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { isSlotStillAvailable } from "@/app/lib/booking/scheduling";
import {
  clientIp,
  duplicateFingerprint,
  getIdempotentResponse,
  isLikelyDuplicate,
  readJsonWithLimit,
  rateLimit,
  setIdempotentResponse,
  verifyTurnstile,
} from "@/app/lib/booking/security";
import { createLeadId, validateSubmission } from "@/app/lib/booking/validation";

export const runtime = "nodejs";
const MAX_BOOKING_SUBMISSION_BYTES = 128 * 1024;

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`submit:${ip}`, 6, 30 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many submission attempts. Try again soon.", 429);

  const body = await readJsonWithLimit(request, MAX_BOOKING_SUBMISSION_BYTES);
  if (!body.ok) return jsonError(body.message, body.status);

  const validation = validateSubmission(body.value);
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

    const notification = await sendOwnerNewLeadNotification(leadId, lead);
    if (!notification.ok) {
      logServerError("booking.owner-notification", new Error(notification.reason), {
        leadId,
        skipped: notification.skipped === true,
      });
    }

    return Response.json(response);
  } catch (error) {
    logServerError("booking.submit", error, { ip, leadId });
    return jsonError(
      "We could not save your request right now. Please try again or call Wade Home Services.",
      503,
    );
  }
}
