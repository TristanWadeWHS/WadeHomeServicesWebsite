import { getSchedulingConfig } from "@/app/lib/booking/config";
import { getCalendarBusyWindows, googleConfigured } from "@/app/lib/booking/google";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import {
  buildAvailabilitySlots,
  buildAvailabilitySlotsForDate,
  calendarQueryRangeForDate,
  isPastBookingDate,
  isValidDateValue,
} from "@/app/lib/booking/scheduling";
import { clientIp, rateLimit } from "@/app/lib/booking/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`availability:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many availability requests. Try again soon.", 429);

  if (!googleConfigured()) {
    return jsonError(
      "Calendar availability is not configured yet. Please call Wade Home Services.",
      503,
    );
  }

  try {
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get("date")?.trim();
    const config = getSchedulingConfig();
    const now = new Date();
    if (requestedDate) {
      if (!isValidDateValue(requestedDate)) {
        return jsonError("Select a valid request date.", 400);
      }
      if (isPastBookingDate(requestedDate, now)) {
        return jsonError("Past dates are not available.", 400);
      }

      const range = calendarQueryRangeForDate(requestedDate);
      if (!range) return jsonError("Select a valid request date.", 400);
      const busy = await getCalendarBusyWindows(range.timeMin, range.timeMax);
      return Response.json({
        ok: true,
        slots: buildAvailabilitySlotsForDate(requestedDate, busy, now),
      });
    }

    const timeMax = new Date(now);
    timeMax.setDate(now.getDate() + config.horizonDays + 1);
    const busy = await getCalendarBusyWindows(now.toISOString(), timeMax.toISOString());
    return Response.json({ ok: true, slots: buildAvailabilitySlots(busy, now) });
  } catch (error) {
    logServerError("booking.availability", error, { ip });
    return jsonError("Calendar availability is temporarily unavailable.", 503);
  }
}
