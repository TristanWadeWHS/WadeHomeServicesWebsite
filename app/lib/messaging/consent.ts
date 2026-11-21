/**
 * Customer messaging policy foundation. No outbound sends occur in this module.
 * Consent is purpose- and channel-specific; staff-entered records must reflect
 * an actual customer choice, not a prechecked default.
 */
export type MessagingChannel = "sms" | "email";
export type MessagingPurpose = "appointment" | "marketing";
export type ConsentSource = "customer_form" | "staff_documented" | "import_verified";
export type ConsentState = "granted" | "revoked";

export interface ConsentRecord {
  id: string;
  customerId: string;
  channel: MessagingChannel;
  purpose: MessagingPurpose;
  state: ConsentState;
  source: ConsentSource;
  recordedAt: string;
  disclosureVersion: string;
  evidenceReference: string;
  recordedBy: string;
}

export interface OutboundMessage {
  id: string;
  customerId: string;
  appointmentId?: string;
  channel: MessagingChannel;
  purpose: MessagingPurpose;
  templateKey: string;
  idempotencyKey: string;
  scheduledFor: string;
}

export function validateConsent(record: ConsentRecord): string[] {
  const errors: string[] = [];
  if (!record.id || !record.customerId) errors.push("Missing consent or customer ID");
  if (!["sms", "email"].includes(record.channel)) errors.push("Invalid channel");
  if (!["appointment", "marketing"].includes(record.purpose)) errors.push("Invalid purpose");
  if (!["granted", "revoked"].includes(record.state)) errors.push("Invalid state");
  if (!["customer_form", "staff_documented", "import_verified"].includes(record.source)) errors.push("Invalid source");
  if (!record.recordedAt || !Number.isFinite(Date.parse(record.recordedAt))) errors.push("Invalid timestamp");
  if (!record.disclosureVersion || !record.evidenceReference || !record.recordedBy) errors.push("Missing consent audit evidence");
  return errors;
}

export function latestConsent(
  records: ConsentRecord[],
  customerId: string,
  channel: MessagingChannel,
  purpose: MessagingPurpose,
): ConsentRecord | undefined {
  return records
    .filter(r => r.customerId === customerId && r.channel === channel && r.purpose === purpose && validateConsent(r).length === 0)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || b.id.localeCompare(a.id))[0];
}

export function maySendMessage(
  message: OutboundMessage,
  records: ConsentRecord[],
  suppressed: boolean,
): { allowed: boolean; reason: string } {
  if (suppressed) return { allowed: false, reason: "Recipient suppressed or opted out" };
  if (!message.customerId || !message.id || !message.idempotencyKey || !message.templateKey) {
    return { allowed: false, reason: "Incomplete message" };
  }
  if (!["sms", "email"].includes(message.channel) || !["appointment", "marketing"].includes(message.purpose)) {
    return { allowed: false, reason: "Invalid message channel or purpose" };
  }
  if (message.purpose === "appointment" && !message.appointmentId) {
    return { allowed: false, reason: "Missing appointment ID" };
  }
  const consent = latestConsent(records, message.customerId, message.channel, message.purpose);
  if (!consent || consent.state !== "granted") return { allowed: false, reason: "No current purpose-specific consent" };
  return { allowed: true, reason: "Eligible for provider and appointment checks" };
}
