import type { AppointmentType, ServiceOption } from "./config";

export type AddressInput = {
  street: string;
  city: string;
  state: string;
  zip: string;
  accessNotes?: string;
};

export type PhotoReference = {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string;
};

export type BookingSubmission = {
  services: ServiceOption[];
  appointmentType: AppointmentType;
  address: AddressInput;
  projectDescription: string;
  photos: PhotoReference[];
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  requestedSlot: {
    start: string;
    end: string;
    label: string;
  };
  honeypot?: string;
  startedAt: number;
  turnstileToken?: string;
  idempotencyKey?: string;
};

export type NormalizedLead = BookingSubmission & {
  normalizedEmail: string;
  normalizedPhone: string;
  normalizedAddress: AddressInput;
};

export type AvailabilitySlot = {
  start: string;
  end: string;
  label: string;
  dateLabel: string;
};
