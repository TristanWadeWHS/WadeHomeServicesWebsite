import type { SheetLead } from "../booking/types";
import type { AssignmentProposalInput } from "./types";

export function assignmentInputFromLead(
  lead: SheetLead,
  overrides: {
    contractorIds?: string[];
    requiredCrewSize?: number;
    travelBufferMinutes?: number;
    travelBufferOverride?: boolean;
    note?: string;
  } = {},
): AssignmentProposalInput | null {
  const start = leadScheduleStart(lead);
  if (!start) return null;
  const end = new Date(
    new Date(start).getTime() + Number(process.env.BOOKING_APPOINTMENT_MINUTES || 120) * 60_000,
  ).toISOString();

  return {
    leadId: lead.leadId,
    jobName: lead.name,
    scheduledStart: start,
    scheduledEnd: end,
    serviceTypes: lead.services,
    city: lead.city,
    accessNotes: lead.accessNotes,
    requiredCrewSize: overrides.requiredCrewSize ?? 1,
    contractorIds: overrides.contractorIds ?? [],
    travelBufferMinutes: overrides.travelBufferMinutes ?? defaultTravelBufferMinutes(),
    travelBufferOverride: Boolean(overrides.travelBufferOverride),
    note: overrides.note ?? "",
  };
}

export function leadScheduleStart(lead: SheetLead) {
  const date = lead.confirmedDate || lead.requestedDate;
  const label = lead.confirmedTime || lead.requestedTime;
  return localDateTimeLabelToIso(date, label);
}

export function localDateTimeLabelToIso(date: string, label: string) {
  const match = label.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!date || !match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const [year, month, day] = date.split("-").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return "";
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = timezoneOffsetMs(
    utcGuess,
    process.env.BOOKING_TIMEZONE || "America/Los_Angeles",
  );
  return new Date(utcGuess.getTime() - offset).toISOString();
}

export function defaultTravelBufferMinutes() {
  const parsed = Number(process.env.CONTRACTOR_TRAVEL_BUFFER_MINUTES || 30);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(240, Math.floor(parsed)) : 30;
}

function timezoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}
