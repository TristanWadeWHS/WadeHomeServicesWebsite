import {
  APPOINTMENT_TYPES,
  LEAD_SOURCE,
  LEAD_STATUS,
  SERVICE_OPTIONS,
} from "./config";
import type { BookingSubmission, NormalizedLead, PhotoReference } from "./types";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;
const VALID_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_PHOTO_COUNT = 15;
export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

export function validateSubmission(input: unknown): ValidationResult<NormalizedLead> {
  const errors: Record<string, string> = {};
  const data = input as Partial<BookingSubmission>;

  if (data.honeypot) {
    errors.honeypot = "Submission could not be accepted.";
  }

  if (!Array.isArray(data.services) || data.services.length === 0) {
    errors.services = "Select at least one service.";
  } else {
    const invalidService = data.services.find(
      (service) => !SERVICE_OPTIONS.includes(service),
    );
    if (invalidService) errors.services = "One or more selected services is invalid.";
  }

  if (!data.appointmentType || !APPOINTMENT_TYPES.includes(data.appointmentType)) {
    errors.appointmentType = "Choose what you would like to schedule.";
  }

  const address = data.address ?? {
    street: "",
    city: "",
    state: "",
    zip: "",
    accessNotes: "",
  };
  const normalizedAddress = {
    street: normalizeText(address.street),
    city: normalizeText(address.city),
    state: normalizeState(address.state),
    zip: normalizeZip(address.zip),
    accessNotes: normalizeText(address.accessNotes ?? ""),
  };

  if (!normalizedAddress.street) errors.street = "Street address is required.";
  if (!normalizedAddress.city) errors.city = "City is required.";
  if (!normalizedAddress.state) errors.state = "State is required.";
  if (!ZIP_PATTERN.test(normalizedAddress.zip)) {
    errors.zip = "Enter a valid ZIP code.";
  }

  const description = normalizeText(data.projectDescription ?? "");
  if (description.length < 8) {
    errors.projectDescription = "Tell us a little about the project.";
  }
  if (description.length > 1400) {
    errors.projectDescription = "Keep the project description under 1,400 characters.";
  }

  const photos = Array.isArray(data.photos) ? data.photos : [];
  if (photos.length > MAX_PHOTO_COUNT) {
    errors.photos = `Upload no more than ${MAX_PHOTO_COUNT} photos.`;
  }
  photos.forEach((photo, index) => {
    const photoError = validatePhotoReference(photo);
    if (photoError) errors[`photo-${index}`] = photoError;
  });

  const customer = data.customer ?? { name: "", email: "", phone: "" };
  const name = normalizeText(customer.name);
  const email = normalizeEmail(customer.email);
  const phone = normalizeText(customer.phone);
  const normalizedPhone = normalizePhone(phone);

  if (!name) errors.name = "Name is required.";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (normalizedPhone.length < 10) errors.phone = "Enter a valid phone number.";

  if (!data.requestedSlot?.start || !data.requestedSlot?.end) {
    errors.requestedSlot = "Select a requested time.";
  }

  if (!data.startedAt || Date.now() - data.startedAt < 4000) {
    errors.timing = "Please review your request before submitting.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      ...(data as BookingSubmission),
      services: data.services!,
      appointmentType: data.appointmentType!,
      projectDescription: description,
      photos,
      address: normalizedAddress,
      normalizedAddress,
      customer: { name, email, phone },
      normalizedEmail: email,
      normalizedPhone,
      requestedSlot: data.requestedSlot!,
    },
  };
}

export function validatePhotoFile(file: File): string | null {
  if (!VALID_IMAGE_TYPES.has(file.type)) return "Use JPG, PNG, WEBP, HEIC, or HEIF images.";
  if (file.size <= 0) return "The selected image appears to be empty.";
  if (file.size > MAX_PHOTO_SIZE_BYTES) return "Each photo must be 10 MB or smaller.";
  return null;
}

export function validatePhotoReference(photo: PhotoReference): string | null {
  if (!photo.id || !photo.url || !photo.name) return "Photo reference is incomplete.";
  if (!VALID_IMAGE_TYPES.has(photo.contentType)) return "Photo type is not allowed.";
  if (photo.size <= 0 || photo.size > MAX_PHOTO_SIZE_BYTES) {
    return "Photo size is invalid.";
  }
  return null;
}

export function createLeadId(date = new Date()) {
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `WHS-${stamp}-${suffix}`;
}

export function mapLeadToColumns(
  leadId: string,
  lead: NormalizedLead,
  headers: readonly string[],
) {
  const createdAt = new Date().toISOString();
  const requestedStart = new Date(lead.requestedSlot.start);
  const requestedDate = requestedStart.toISOString().slice(0, 10);
  const requestedTime = lead.requestedSlot.label;
  const photoRefs = lead.photos.map((photo) => photo.url).join("\n");
  const values: Record<string, string> = {
    "Unique ID": leadId,
    "Created At": createdAt,
    Status: LEAD_STATUS,
    Name: lead.customer.name,
    Email: lead.normalizedEmail,
    "Phone Number": lead.customer.phone,
    "Street Address": lead.normalizedAddress.street,
    City: lead.normalizedAddress.city,
    State: lead.normalizedAddress.state,
    "ZIP Code": lead.normalizedAddress.zip,
    "Optional Unit / Gate / Access Notes": lead.normalizedAddress.accessNotes ?? "",
    "Service Type(s)": lead.services.join(", "),
    "Appointment Type": lead.appointmentType,
    "Project Description": lead.projectDescription,
    "Photo URLs / Photo References": photoRefs,
    "Requested Date": requestedDate,
    "Requested Time": requestedTime,
    Source: LEAD_SOURCE,
    "Internal Notes": "Website request awaiting owner review.",
  };

  return headers.map((header) => escapeSheetCell(values[header] ?? ""));
}

export function normalizeEmail(value: string) {
  return normalizeText(value).toLowerCase();
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeState(value: string) {
  return normalizeText(value).toUpperCase();
}

function normalizeZip(value: string) {
  return normalizeText(value).replace(/[^\d-]/g, "");
}

export function escapeSheetCell(value: string) {
  const normalized = normalizeText(value);
  return /^[=+\-@\t\r]/.test(normalized) ? `'${normalized}` : normalized;
}
