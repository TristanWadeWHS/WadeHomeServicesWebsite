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

export type SheetLead = {
  rowNumber: number;
  leadId: string;
  createdAt: string;
  status: string;
  name: string;
  email: string;
  phone: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  accessNotes: string;
  services: string;
  appointmentType: string;
  projectDescription: string;
  photoReferences: string;
  requestedDate: string;
  requestedTime: string;
  source: string;
  internalNotes: string;
  decisionTimestamp: string;
  calendarEventId: string;
  confirmedDate: string;
  confirmedTime: string;
  declineReason: string;
  emailStatus: string;
  approvedAmount: string;
  businessOwner: string;
  operationalStatus: string;
  completedAt: string;
  completionFinalAmount: string;
  projectCosts: string;
  distance: string;
  completionNotes: string;
  closedAt: string;
  closedBy: string;
  closeReason: string;
  historicalTransferStatus: string;
  historicalTransferTimestamp: string;
  auditTrail: string;
};

export type OwnerDecisionResult = {
  ok: true;
  lead: SheetLead;
  calendarEventCreated: boolean;
  emailStatus: string;
} | {
  ok: false;
  message: string;
  lead?: SheetLead;
};
