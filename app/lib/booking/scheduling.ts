import { getSchedulingConfig } from "./config";
import type { AvailabilitySlot } from "./types";

export type BusyWindow = {
  start: string;
  end: string;
};

export function buildAvailabilitySlots(
  busyWindows: BusyWindow[],
  now = new Date(),
): AvailabilitySlot[] {
  const config = getSchedulingConfig();
  const slots: AvailabilitySlot[] = [];
  const earliest = new Date(
    now.getTime() + config.minimumAdvanceHours * 60 * 60 * 1000,
  );

  for (let dayOffset = 0; dayOffset <= config.horizonDays; dayOffset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);

    for (
      let minutes = config.openingHour * 60;
      minutes + config.appointmentMinutes <= config.closingHour * 60;
      minutes += config.intervalMinutes
    ) {
      const start = zonedDateTime(day, minutes, config.timezone);
      const end = new Date(start.getTime() + config.appointmentMinutes * 60 * 1000);
      if (start < earliest) continue;
      if (overlapsBusy(start, end, busyWindows, config.bufferMinutes)) continue;

      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        label: formatSlotLabel(start, config.timezone),
        dateLabel: formatDateLabel(start, config.timezone),
      });
    }
  }

  return slots.slice(0, 40);
}

export function buildAvailabilitySlotsForDate(
  dateValue: string,
  busyWindows: BusyWindow[],
  now = new Date(),
): AvailabilitySlot[] {
  const config = getSchedulingConfig();
  const date = parseDateValue(dateValue);
  if (!date) return [];

  const slots: AvailabilitySlot[] = [];
  const earliest = new Date(
    now.getTime() + config.minimumAdvanceHours * 60 * 60 * 1000,
  );

  for (
    let minutes = config.openingHour * 60;
    minutes + config.appointmentMinutes <= config.closingHour * 60;
    minutes += config.intervalMinutes
  ) {
    const start = makeDateInTimeZone(
      date.year,
      date.month,
      date.day,
      Math.floor(minutes / 60),
      minutes % 60,
      config.timezone,
    );
    const end = new Date(start.getTime() + config.appointmentMinutes * 60 * 1000);
    if (start < earliest) continue;
    if (overlapsBusy(start, end, busyWindows, config.bufferMinutes)) continue;

    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: formatSlotLabel(start, config.timezone),
      dateLabel: formatDateLabel(start, config.timezone),
    });
  }

  return slots;
}

export function isValidDateValue(dateValue: string) {
  return parseDateValue(dateValue) !== null;
}

export function isPastBookingDate(dateValue: string, now = new Date()) {
  const config = getSchedulingConfig();
  return dateValue < formatDateValue(now, config.timezone);
}

export function calendarQueryRangeForDate(dateValue: string) {
  const config = getSchedulingConfig();
  const date = parseDateValue(dateValue);
  if (!date) return null;

  const start = makeDateInTimeZone(date.year, date.month, date.day, 0, 0, config.timezone);
  const end = makeDateInTimeZone(date.year, date.month, date.day + 1, 0, 0, config.timezone);
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  };
}

export function isSlotStillAvailable(
  requestedStart: string,
  requestedEnd: string,
  busyWindows: BusyWindow[],
) {
  const start = new Date(requestedStart);
  const end = new Date(requestedEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return !overlapsBusy(start, end, busyWindows, getSchedulingConfig().bufferMinutes);
}

function overlapsBusy(
  start: Date,
  end: Date,
  busyWindows: BusyWindow[],
  bufferMinutes: number,
) {
  const bufferMs = bufferMinutes * 60 * 1000;
  return busyWindows.some((busy) => {
    const busyStart = new Date(new Date(busy.start).getTime() - bufferMs);
    const busyEnd = new Date(new Date(busy.end).getTime() + bufferMs);
    return start < busyEnd && end > busyStart;
  });
}

function zonedDateTime(
  baseDate: Date,
  minutesAfterMidnight: number,
  timezone: string,
) {
  const parts = dateParts(baseDate, timezone);
  const hour = Math.floor(minutesAfterMidnight / 60);
  const minute = minutesAfterMidnight % 60;
  return makeDateInTimeZone(
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute,
    timezone,
  );
}

function dateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function parseDateValue(dateValue: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function makeDateInTimeZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMs = timezoneOffsetMs(utcGuess, timezone);
  return new Date(utcGuess.getTime() - offsetMs);
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function formatSlotLabel(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function formatDateLabel(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(date);
}

function formatDateValue(date: Date, timezone: string) {
  const parts = dateParts(date, timezone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}
