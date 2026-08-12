export const SERVICE_OPTIONS = [
  "Junk Removal",
  "Light Demolition",
  "Storage / Relocation",
] as const;

export const APPOINTMENT_TYPES = [
  "On-Site Estimate",
  "Service Appointment Request",
] as const;

export const LEAD_STATUS = "Pending Approval";
export const LEAD_SOURCE = "Website";

export const REQUIRED_SHEET_COLUMNS = [
  "Unique ID",
  "Created At",
  "Status",
  "Name",
  "Email",
  "Phone Number",
  "Street Address",
  "City",
  "State",
  "ZIP Code",
  "Optional Unit / Gate / Access Notes",
  "Service Type(s)",
  "Appointment Type",
  "Project Description",
  "Photo URLs / Photo References",
  "Requested Date",
  "Requested Time",
  "Source",
  "Internal Notes",
] as const;

export type ServiceOption = (typeof SERVICE_OPTIONS)[number];
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export function getSchedulingConfig() {
  return {
    timezone: process.env.BOOKING_TIMEZONE || "America/Los_Angeles",
    openingHour: numberFromEnv("BOOKING_OPENING_HOUR", 7),
    closingHour: numberFromEnv("BOOKING_CLOSING_HOUR", 20),
    appointmentMinutes: numberFromEnv("BOOKING_APPOINTMENT_MINUTES", 120),
    intervalMinutes: numberFromEnv("BOOKING_INTERVAL_MINUTES", 60),
    bufferMinutes: numberFromEnv("BOOKING_BUFFER_MINUTES", 0),
    minimumAdvanceHours: numberFromEnv("BOOKING_MIN_ADVANCE_HOURS", 12),
    horizonDays: numberFromEnv("BOOKING_HORIZON_DAYS", 21),
  };
}

function numberFromEnv(key: string, fallback: number) {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
