import {
  APPROVED_STATUS,
  CLOSED_STATUS,
  CONFLICT_STATUS,
  COMPLETED_STATUS,
  DECLINED_STATUS,
  IN_PROGRESS_STATUS,
  LEAD_STATUS,
  LEGACY_APPROVED_STATUS,
  MANUAL_LEAD_STATUS,
  REQUIRED_SHEET_COLUMNS,
} from "./config";
import type { BusyWindow } from "./scheduling";
import { isSlotStillAvailable } from "./scheduling";
import type { NormalizedLead, NormalizedManualLead, OwnerDecisionResult, SheetLead } from "./types";
import {
  escapeSheetCell,
  mapLeadToColumns,
  mapManualLeadToColumns,
  parsePhotoReferences,
} from "./validation";
import { sendCustomerApprovalConfirmation } from "./ownerNotifications";

export const HISTORICAL_SPREADSHEET_ID =
  "1VKZgdAwWURAkACKSUrEGSoNib1xQaQ7zzpBGfwneOeI";
export const HISTORICAL_TRANSFER_COMPLETE = "Transferred";

export type CloseoutInput = {
  finalAmount: string;
  projectCosts: string;
  distance?: string;
  notes?: string;
  owner?: string;
};

export type CloseRequestInput = {
  reason: string;
  note?: string;
};

export type JobStatusInput = typeof APPROVED_STATUS | typeof IN_PROGRESS_STATUS;

export type CompletionResult = {
  ok: true;
  lead: SheetLead;
  historicalAppended: boolean;
} | {
  ok: false;
  message: string;
  lead?: SheetLead;
};

type GoogleToken = {
  accessToken: string;
  expiresAt: number;
};

type GoogleCredentials = {
  clientEmail: string;
  privateKey: string;
};

let cachedToken: GoogleToken | null = null;
const cachedTokens = new Map<string, GoogleToken>();

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar";

export function googleConfigured() {
  return Boolean(
    getGoogleCredentials() &&
      getSpreadsheetId() &&
      process.env.GOOGLE_CALENDAR_ID,
  );
}

export async function getCalendarBusyWindows(
  timeMin: string,
  timeMax: string,
): Promise<BusyWindow[]> {
  const calendarId = requireEnv("GOOGLE_CALENDAR_ID");
  const token = await getGoogleAccessToken([CALENDAR_SCOPE]);
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Calendar free/busy failed with ${response.status}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    calendars?: Record<string, { busy?: BusyWindow[] }>;
  };
  return payload.calendars?.[calendarId]?.busy ?? [];
}

export async function appendLeadToSheet(leadId: string, lead: NormalizedLead) {
  const spreadsheetId = requireSpreadsheetId();
  const sheetName = process.env.GOOGLE_SHEET_TAB || "Open Leads";
  const token = await getGoogleAccessToken([SHEETS_SCOPE]);
  const headers = await getSheetHeaders(spreadsheetId, sheetName, token);
  const completeHeaders = await ensureSheetHeaders(
    spreadsheetId,
    sheetName,
    token,
    headers,
  );
  const row = mapLeadToColumns(leadId, lead, completeHeaders);

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      sheetName,
    )}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Google Sheets append failed with ${response.status}: ${await response.text()}`,
    );
  }
}

export async function appendManualLeadToSheet(leadId: string, lead: NormalizedManualLead) {
  const spreadsheetId = requireSpreadsheetId();
  const sheetName = process.env.GOOGLE_SHEET_TAB || "Open Leads";
  const token = await getGoogleAccessToken([SHEETS_SCOPE]);
  const headers = await getSheetHeaders(spreadsheetId, sheetName, token);
  const completeHeaders = await ensureSheetHeaders(
    spreadsheetId,
    sheetName,
    token,
    headers,
  );
  const row = mapManualLeadToColumns(leadId, lead, completeHeaders);

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      sheetName,
    )}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Google Sheets manual lead append failed with ${response.status}: ${await response.text()}`,
    );
  }

  return sheetRowToLead(completeHeaders, row, 0);
}

export async function getPendingLeads() {
  return getRequestLeads();
}

export async function getRequestLeads() {
  const { headers, rows } = await getSheetRows();
  return rows
    .map((row, index) => sheetRowToLead(headers, row, index + 2))
    .filter((lead) => lead.status === LEAD_STATUS || lead.status === CONFLICT_STATUS);
}

export async function getActiveJobs() {
  const { headers, rows } = await getSheetRows();
  const activeStatuses = new Set([APPROVED_STATUS, LEGACY_APPROVED_STATUS, IN_PROGRESS_STATUS]);
  return rows
    .map((row, index) => sheetRowToLead(headers, row, index + 2))
    .filter((lead) => activeStatuses.has(lead.status));
}

export async function getManualLeads() {
  const { headers, rows } = await getSheetRows();
  return rows
    .map((row, index) => sheetRowToLead(headers, row, index + 2))
    .filter((lead) => lead.status === MANUAL_LEAD_STATUS);
}

export async function getLeadById(leadId: string) {
  const { headers, rows } = await getSheetRows();
  const index = rows.findIndex((row) => row[headers.indexOf("Unique ID")] === leadId);
  if (index < 0) return null;
  return sheetRowToLead(headers, rows[index], index + 2);
}

export async function approveLead(
  leadId: string,
  approvedAmountValue = "",
  businessOwnerValue = "",
  approvedBy = "Owner",
): Promise<OwnerDecisionResult> {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, message: "Lead not found." };
  if ((lead.status === APPROVED_STATUS || lead.status === LEGACY_APPROVED_STATUS) && lead.calendarEventId) {
    return {
      ok: true,
      lead,
      calendarEventCreated: false,
      emailStatus: lead.emailStatus || emailNeedsConfigurationStatus(),
    };
  }
  if (lead.status !== LEAD_STATUS) {
    return { ok: false, message: `Lead is ${lead.status}.`, lead };
  }
  const approvedAmount = parseNonNegativeMoney(approvedAmountValue, "Approved amount");
  if (!approvedAmount.ok) return { ok: false, message: approvedAmount.message, lead };
  const businessOwner = sanitizeRequiredText(businessOwnerValue, "Owner", 120);
  if (!businessOwner.ok) return { ok: false, message: businessOwner.message, lead };

  const slot = leadToRequestedSlot(lead);
  if (!slot) return { ok: false, message: "Lead requested time could not be read.", lead };

  const busy = await getCalendarBusyWindows(slot.start, slot.end);
  if (!isSlotStillAvailable(slot.start, slot.end, busy)) {
    const updated = await updateLeadColumns(lead, {
      Status: CONFLICT_STATUS,
      "Approval / Decision Timestamp": new Date().toISOString(),
      "Internal Notes": appendInternalNote(
        lead.internalNotes,
        "Requested time is no longer available at approval.",
      ),
    });
    return {
      ok: false,
      message: "Requested time is no longer available.",
      lead: updated,
    };
  }

  const existingEventId =
    lead.calendarEventId || (await findCalendarEventIdForLead(lead.leadId, slot.start, slot.end));
  const eventId = existingEventId || (await createCalendarEventForLead(lead, slot));
  const emailStatus = "Customer confirmation pending.";
  const timestamp = new Date().toISOString();
  const updated = await updateLeadColumns(lead, {
    Status: APPROVED_STATUS,
    "Approved Amount": formatMoney(approvedAmount.value),
    Owner: businessOwner.value,
    "Operational Status": APPROVED_STATUS,
    "Approval / Decision Timestamp": timestamp,
    "Google Calendar Event ID": eventId,
    "Confirmed Date": lead.requestedDate,
    "Confirmed Time": lead.requestedTime,
    "Email Status": emailStatus,
    "Audit Trail": appendAuditEntry(
      lead.auditTrail,
      `${approvedBy} approved request for ${formatMoney(approvedAmount.value)}. Owner: ${businessOwner.value}.`,
      timestamp,
    ),
    "Internal Notes": appendInternalNote(
      lead.internalNotes,
      existingEventId
        ? "Owner approved request; existing Calendar event reused."
        : "Owner approved request; Calendar event created.",
    ),
  });

  const confirmation = await safeSendCustomerApprovalConfirmation(updated);
  const finalEmailStatus = customerConfirmationEmailStatus(confirmation);
  let finalLead = updated;
  try {
    finalLead = await updateLeadColumns(updated, {
      "Email Status": finalEmailStatus,
      "Internal Notes": appendInternalNote(
        updated.internalNotes,
        confirmation.ok
          ? "Customer confirmation email sent after owner approval."
          : `Customer confirmation email failed after owner approval: ${confirmation.reason}`,
      ),
    });
  } catch (error) {
    logCustomerConfirmationFailure(
      lead.leadId,
      `Customer confirmation status could not be recorded: ${errorMessage(error)}`,
    );
  }
  if (!confirmation.ok) logCustomerConfirmationFailure(lead.leadId, confirmation.reason);

  return {
    ok: true,
    lead: finalLead,
    calendarEventCreated: !existingEventId,
    emailStatus: finalEmailStatus,
  };
}

export async function declineLead(
  leadId: string,
  reason: string,
  declinedBy = "Owner",
): Promise<OwnerDecisionResult> {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, message: "Lead not found." };
  if (lead.status !== LEAD_STATUS) {
    return { ok: false, message: `Lead is ${lead.status}.`, lead };
  }

  const emailStatus = emailNeedsConfigurationStatus();
  const timestamp = new Date().toISOString();
  const updated = await updateLeadColumns(lead, {
    Status: DECLINED_STATUS,
    "Operational Status": DECLINED_STATUS,
    "Approval / Decision Timestamp": timestamp,
    "Decline Reason": sanitizeDecisionReason(reason),
    "Email Status": emailStatus,
    "Audit Trail": appendAuditEntry(
      lead.auditTrail,
      `${declinedBy} declined request: ${sanitizeDecisionReason(reason)}`,
      timestamp,
    ),
    "Internal Notes": appendInternalNote(
      lead.internalNotes,
      `Owner declined request: ${sanitizeDecisionReason(reason)}`,
    ),
  });

  return {
    ok: true,
    lead: updated,
    calendarEventCreated: false,
    emailStatus,
  };
}

export async function closeLead(
  leadId: string,
  input: CloseRequestInput,
  closedBy = "Owner",
): Promise<OwnerDecisionResult> {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, message: "Lead not found." };
  if (lead.status !== LEAD_STATUS && lead.status !== CONFLICT_STATUS) {
    return { ok: false, message: `Lead is ${lead.status}.`, lead };
  }

  const reason = sanitizeCloseReason(input.reason, input.note);
  const timestamp = new Date().toISOString();
  const updated = await updateLeadColumns(lead, {
    Status: CLOSED_STATUS,
    "Operational Status": CLOSED_STATUS,
    "Closed At": timestamp,
    "Closed By": closedBy,
    "Close Reason": reason,
    "Audit Trail": appendAuditEntry(
      lead.auditTrail,
      `${closedBy} closed request. Old status: ${lead.status}. New status: ${CLOSED_STATUS}. Reason: ${reason}.`,
      timestamp,
    ),
    "Internal Notes": appendInternalNote(
      lead.internalNotes,
      `Request closed by ${closedBy}: ${reason}`,
    ),
  });

  return {
    ok: true,
    lead: updated,
    calendarEventCreated: false,
    emailStatus: lead.emailStatus || emailNeedsConfigurationStatus(),
  };
}

export async function updateJobStatus(
  leadId: string,
  status: JobStatusInput,
  updatedBy = "Operations",
) {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false as const, message: "Lead not found." };
  const currentStatus = normalizeOperationalStatus(lead.status);
  const allowedCurrent = new Set([APPROVED_STATUS, IN_PROGRESS_STATUS]);
  if (!allowedCurrent.has(currentStatus)) {
    return { ok: false as const, message: `Lead is ${lead.status}.`, lead };
  }
  if (status !== APPROVED_STATUS && status !== IN_PROGRESS_STATUS) {
    return { ok: false as const, message: "Unsupported job status.", lead };
  }

  const timestamp = new Date().toISOString();
  const updated = await updateLeadColumns(lead, {
    Status: status,
    "Operational Status": status,
    "Audit Trail": appendAuditEntry(
      lead.auditTrail,
      `${updatedBy} set job status to ${status}.`,
      timestamp,
    ),
  });
  return { ok: true as const, lead: updated };
}

export async function completeJob(
  leadId: string,
  input: CloseoutInput,
  completedBy = "Operations",
): Promise<CompletionResult> {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, message: "Lead not found." };

  if (lead.status === COMPLETED_STATUS && lead.historicalTransferStatus === HISTORICAL_TRANSFER_COMPLETE) {
    return { ok: true, lead, historicalAppended: false };
  }

  const currentStatus = normalizeOperationalStatus(lead.status);
  if (currentStatus !== APPROVED_STATUS && currentStatus !== IN_PROGRESS_STATUS) {
    return { ok: false, message: `Lead is ${lead.status}.`, lead };
  }

  const closeout = validateCloseout(input);
  if (!closeout.ok) return { ok: false, message: closeout.message, lead };
  const existingOwner = lead.businessOwner.trim();
  const fallbackOwner = existingOwner ? null : sanitizeRequiredText(input.owner ?? "", "Owner", 120);
  if (fallbackOwner?.ok === false) return { ok: false, message: fallbackOwner.message, lead };
  const businessOwner = existingOwner || fallbackOwner?.value || "";
  const ownerUpdate: Record<string, string> = existingOwner ? {} : { Owner: businessOwner };
  const leadForHistorical = { ...lead, businessOwner };

  const timestamp = new Date().toISOString();
  if (lead.historicalTransferStatus !== HISTORICAL_TRANSFER_COMPLETE) {
    await appendHistoricalJob(leadForHistorical, closeout.value, timestamp, completedBy);
  }

  const updated = await updateLeadColumns(lead, {
    ...ownerUpdate,
    Status: COMPLETED_STATUS,
    "Operational Status": COMPLETED_STATUS,
    "Completed At": timestamp,
    "Completion Final Amount": formatMoney(closeout.value.finalAmount),
    "Project Costs": formatMoney(closeout.value.projectCosts),
    Distance: closeout.value.distance === null ? "" : String(closeout.value.distance),
    "Completion Notes": closeout.value.notes,
    "Historical Transfer Status": HISTORICAL_TRANSFER_COMPLETE,
    "Historical Transfer Timestamp": timestamp,
    "Audit Trail": appendAuditEntry(
      lead.auditTrail,
      `${completedBy} completed job and transferred historical record. Owner: ${businessOwner}.`,
      timestamp,
    ),
  });

  return { ok: true, lead: updated, historicalAppended: lead.historicalTransferStatus !== HISTORICAL_TRANSFER_COMPLETE };
}

async function getSheetHeaders(
  spreadsheetId: string,
  sheetName: string,
  token: string,
) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      sheetName,
    )}!1:1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets header read failed with ${response.status}: ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as { values?: string[][] };
  return payload.values?.[0] ?? [];
}

async function ensureSheetHeaders(
  spreadsheetId: string,
  sheetName: string,
  token: string,
  existingHeaders: string[],
) {
  const missing = REQUIRED_SHEET_COLUMNS.filter(
    (column) => !existingHeaders.includes(column),
  );
  if (missing.length === 0) return existingHeaders;

  const headers = [...existingHeaders, ...missing];
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      sheetName,
    )}!1:1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [headers] }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets header update failed with ${response.status}: ${await response.text()}`,
    );
  }
  return headers;
}

async function getSheetRows() {
  const spreadsheetId = requireSpreadsheetId();
  const sheetName = process.env.GOOGLE_SHEET_TAB || "Open Leads";
  const token = await getGoogleAccessToken([SHEETS_SCOPE]);
  const headers = await ensureSheetHeaders(
    spreadsheetId,
    sheetName,
    token,
    await getSheetHeaders(spreadsheetId, sheetName, token),
  );
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      sheetName,
    )}!A2:ZZ`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets row read failed with ${response.status}: ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as { values?: string[][] };
  return { headers, rows: payload.values ?? [] };
}

async function updateLeadColumns(lead: SheetLead, values: Record<string, string>) {
  const spreadsheetId = requireSpreadsheetId();
  const sheetName = process.env.GOOGLE_SHEET_TAB || "Open Leads";
  const token = await getGoogleAccessToken([SHEETS_SCOPE]);
  const headers = await ensureSheetHeaders(
    spreadsheetId,
    sheetName,
    token,
    await getSheetHeaders(spreadsheetId, sheetName, token),
  );
  const current = leadToRow(headers, lead);
  for (const [header, value] of Object.entries(values)) {
    const index = headers.indexOf(header);
    if (index >= 0) current[index] = escapeSheetCell(value);
  }

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetName}!A${lead.rowNumber}:ZZ${lead.rowNumber}`,
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [current] }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets lead update failed with ${response.status}: ${await response.text()}`,
    );
  }

  return sheetRowToLead(headers, current, lead.rowNumber);
}

async function findCalendarEventIdForLead(
  leadId: string,
  timeMin: string,
  timeMax: string,
) {
  const calendarId = requireEnv("GOOGLE_CALENDAR_ID");
  const token = await getGoogleAccessToken([CALENDAR_EVENTS_SCOPE]);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId,
    )}/events?${new URLSearchParams({
      privateExtendedProperty: `leadId=${leadId}`,
      singleEvents: "true",
      timeMin,
      timeMax,
    })}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Google Calendar event lookup failed with ${response.status}: ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as { items?: Array<{ id?: string }> };
  return payload.items?.[0]?.id ?? "";
}

async function createCalendarEventForLead(
  lead: SheetLead,
  slot: { start: string; end: string },
) {
  const calendarId = requireEnv("GOOGLE_CALENDAR_ID");
  const token = await getGoogleAccessToken([CALENDAR_EVENTS_SCOPE]);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId,
    )}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildCalendarEventResource(lead, slot)),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Google Calendar event creation failed with ${response.status}: ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) throw new Error("Google Calendar event creation returned no event id.");
  return payload.id;
}

export function buildCalendarEventResource(
  lead: SheetLead,
  slot: { start: string; end: string },
) {
  const timezone = process.env.BOOKING_TIMEZONE || "America/Los_Angeles";
  return {
    summary: `WHS - ${lead.services || "Service"} - ${lead.name}`,
    description: calendarDescription(lead),
    start: {
      dateTime: slot.start,
      timeZone: timezone,
    },
    end: {
      dateTime: slot.end,
      timeZone: timezone,
    },
    transparency: "opaque",
    extendedProperties: { private: { leadId: lead.leadId } },
  };
}

async function getGoogleAccessToken(scopes: string[]) {
  const cacheKey = [...scopes].sort().join(" ");
  const scopedToken = cachedTokens.get(cacheKey);
  if (scopedToken && scopedToken.expiresAt > Date.now() + 60_000) {
    return scopedToken.accessToken;
  }
  if (
    cachedToken &&
    cacheKey === CALENDAR_SCOPE &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const credentials = requireGoogleCredentials();
  const assertion = await signJwt({
    iss: credentials.clientEmail,
    scope: scopes.join(" "),
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) throw new Error(`Google token request failed with ${response.status}`);

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  const token = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  cachedTokens.set(cacheKey, token);
  if (cacheKey === CALENDAR_SCOPE) cachedToken = token;
  return token.accessToken;
}

async function signJwt(payload: object) {
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload),
  )}`;
  const { createSign } = await import("node:crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const credentials = requireGoogleCredentials();
  const signature = signer.sign(normalizePrivateKey(credentials.privateKey));
  return `${unsigned}.${base64Url(signature)}`;
}

function getGoogleCredentials(): GoogleCredentials | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as {
        client_email?: string;
        private_key?: string;
      };
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
    } catch {
      return null;
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_PRIVATE_KEY,
    };
  }

  return null;
}

function requireGoogleCredentials() {
  const credentials = getGoogleCredentials();
  if (!credentials) {
    throw new Error(
      "Missing Google service account credentials. Configure GOOGLE_SERVICE_ACCOUNT_JSON or split service account variables.",
    );
  }
  return credentials;
}

function getSpreadsheetId() {
  return process.env.GOOGLE_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "";
}

function requireSpreadsheetId() {
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) {
    throw new Error(
      "Missing required environment variable: GOOGLE_SPREADSHEET_ID or GOOGLE_SHEETS_SPREADSHEET_ID",
    );
  }
  return spreadsheetId;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function requireEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function sheetRowToLead(
  headers: readonly string[],
  row: readonly string[],
  rowNumber: number,
): SheetLead {
  const value = (header: string) => row[headers.indexOf(header)] ?? "";
  return {
    rowNumber,
    leadId: value("Unique ID"),
    createdAt: value("Created At"),
    status: value("Status"),
    name: value("Name"),
    email: value("Email"),
    phone: value("Phone Number"),
    streetAddress: value("Street Address"),
    city: value("City"),
    state: value("State"),
    zip: value("ZIP Code"),
    accessNotes: value("Optional Unit / Gate / Access Notes"),
    services: value("Service Type(s)"),
    appointmentType: value("Appointment Type"),
    projectDescription: value("Project Description"),
    photoReferences: value("Photo URLs / Photo References"),
    photos: parsePhotoReferences(value("Photo URLs / Photo References")),
    requestedDate: value("Requested Date"),
    requestedTime: value("Requested Time"),
    source: value("Source"),
    internalNotes: value("Internal Notes"),
    decisionTimestamp: value("Approval / Decision Timestamp"),
    calendarEventId: value("Google Calendar Event ID"),
    confirmedDate: value("Confirmed Date"),
    confirmedTime: value("Confirmed Time"),
    declineReason: value("Decline Reason"),
    emailStatus: value("Email Status"),
    approvedAmount: value("Approved Amount"),
    businessOwner: value("Owner"),
    operationalStatus: value("Operational Status"),
    completedAt: value("Completed At"),
    completionFinalAmount: value("Completion Final Amount"),
    projectCosts: value("Project Costs"),
    distance: value("Distance"),
    completionNotes: value("Completion Notes"),
    closedAt: value("Closed At"),
    closedBy: value("Closed By"),
    closeReason: value("Close Reason"),
    historicalTransferStatus: value("Historical Transfer Status"),
    historicalTransferTimestamp: value("Historical Transfer Timestamp"),
    auditTrail: value("Audit Trail"),
  };
}

function leadToRow(headers: readonly string[], lead: SheetLead) {
  const values: Record<string, string> = {
    "Unique ID": lead.leadId,
    "Created At": lead.createdAt,
    Status: lead.status,
    Name: lead.name,
    Email: lead.email,
    "Phone Number": lead.phone,
    "Street Address": lead.streetAddress,
    City: lead.city,
    State: lead.state,
    "ZIP Code": lead.zip,
    "Optional Unit / Gate / Access Notes": lead.accessNotes,
    "Service Type(s)": lead.services,
    "Appointment Type": lead.appointmentType,
    "Project Description": lead.projectDescription,
    "Photo URLs / Photo References": lead.photoReferences,
    "Requested Date": lead.requestedDate,
    "Requested Time": lead.requestedTime,
    Source: lead.source,
    "Internal Notes": lead.internalNotes,
    "Approval / Decision Timestamp": lead.decisionTimestamp,
    "Google Calendar Event ID": lead.calendarEventId,
    "Confirmed Date": lead.confirmedDate,
    "Confirmed Time": lead.confirmedTime,
    "Decline Reason": lead.declineReason,
    "Email Status": lead.emailStatus,
    "Approved Amount": lead.approvedAmount,
    Owner: lead.businessOwner,
    "Operational Status": lead.operationalStatus,
    "Completed At": lead.completedAt,
    "Completion Final Amount": lead.completionFinalAmount,
    "Project Costs": lead.projectCosts,
    Distance: lead.distance,
    "Completion Notes": lead.completionNotes,
    "Closed At": lead.closedAt,
    "Closed By": lead.closedBy,
    "Close Reason": lead.closeReason,
    "Historical Transfer Status": lead.historicalTransferStatus,
    "Historical Transfer Timestamp": lead.historicalTransferTimestamp,
    "Audit Trail": lead.auditTrail,
  };
  return headers.map((header) => values[header] ?? "");
}

function leadToRequestedSlot(lead: SheetLead) {
  const start = requestedDateTimeToIso(lead.requestedDate, lead.requestedTime);
  if (!start) return null;
  const end = new Date(
    new Date(start).getTime() + Number(process.env.BOOKING_APPOINTMENT_MINUTES || 120) * 60_000,
  ).toISOString();
  return { start, end };
}

function requestedDateTimeToIso(date: string, label: string) {
  const match = label.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!date || !match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = timezoneOffsetMs(
    utcGuess,
    process.env.BOOKING_TIMEZONE || "America/Los_Angeles",
  );
  return new Date(utcGuess.getTime() - offset).toISOString();
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

function calendarDescription(lead: SheetLead) {
  const address = `${lead.streetAddress}, ${lead.city}, ${lead.state} ${lead.zip}`;
  return [
    `Lead ID: ${lead.leadId}`,
    `Customer Name: ${lead.name}`,
    `Phone Number: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Service Address: ${address}`,
    `Service Type(s): ${lead.services}`,
    `Appointment Type: ${lead.appointmentType}`,
    "",
    "Project Description:",
    lead.projectDescription,
    "",
    `Google Sheet Reference: ${lead.leadId}`,
  ].join("\n");
}

function appendInternalNote(existing: string, note: string) {
  const stamp = new Date().toISOString();
  return [existing, `[${stamp}] ${note}`].filter(Boolean).join("\n");
}

function appendAuditEntry(existing: string, note: string, timestamp = new Date().toISOString()) {
  return [existing, `[${timestamp}] ${note}`].filter(Boolean).join("\n");
}

function sanitizeDecisionReason(reason: string) {
  return reason.replace(/\s+/g, " ").trim().slice(0, 300) || "No reason provided";
}

function sanitizeCloseReason(reason: string, note = "") {
  const base = sanitizeDecisionReason(reason);
  const extra = note.replace(/\s+/g, " ").trim().slice(0, 220);
  return extra ? `${base}: ${extra}` : base;
}

function sanitizeRequiredText(value: string, label: string, maxLength: number): {
  ok: true;
  value: string;
} | {
  ok: false;
  message: string;
} {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return { ok: false, message: `${label} is required.` };
  if (normalized.length > maxLength) {
    return { ok: false, message: `${label} must be ${maxLength} characters or fewer.` };
  }
  return { ok: true, value: normalized };
}

function emailNeedsConfigurationStatus() {
  return "Needs configuration: no email provider configured";
}

async function safeSendCustomerApprovalConfirmation(lead: SheetLead) {
  try {
    return await sendCustomerApprovalConfirmation(lead);
  } catch (error) {
    return {
      ok: false as const,
      reason: `Customer confirmation failed with provider/network error: ${errorMessage(error)}`,
    };
  }
}

function customerConfirmationEmailStatus(
  result: Awaited<ReturnType<typeof safeSendCustomerApprovalConfirmation>>,
) {
  if (!result.ok) return `Customer confirmation failed: ${result.reason}`;
  return result.messageId
    ? `Customer confirmation sent via Brevo (${result.messageId}).`
    : "Customer confirmation sent via Brevo.";
}

function logCustomerConfirmationFailure(leadId: string, message: string) {
  console.error(
    JSON.stringify({
      level: "error",
      scope: "customer.confirmation",
      message,
      context: { leadId },
    }),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Unknown error";
}

type MoneyParseResult =
  | { ok: true; value: number }
  | { ok: false; message: string };

type CloseoutValues = {
  finalAmount: number;
  projectCosts: number;
  distance: number | null;
  notes: string;
};

function parseNonNegativeMoney(value: string, label: string): MoneyParseResult {
  const cleaned = String(value ?? "").replace(/[$,]/g, "").trim();
  if (!cleaned) return { ok: false, message: `${label} is required.` };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, message: `${label} must be a non-negative number.` };
  }
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

function parseOptionalNonNegativeNumber(value: string, label: string) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return { ok: true as const, value: null };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false as const, message: `${label} must be a non-negative number.` };
  }
  return { ok: true as const, value: Math.round(parsed * 100) / 100 };
}

function validateCloseout(input: CloseoutInput): {
  ok: true;
  value: CloseoutValues;
} | {
  ok: false;
  message: string;
} {
  const finalAmount = parseNonNegativeMoney(input.finalAmount, "Final amount");
  if (!finalAmount.ok) return finalAmount;
  const projectCosts = parseNonNegativeMoney(input.projectCosts, "Project costs");
  if (!projectCosts.ok) return projectCosts;
  const distance = parseOptionalNonNegativeNumber(input.distance ?? "", "Distance");
  if (!distance.ok) return distance;

  return {
    ok: true,
    value: {
      finalAmount: finalAmount.value,
      projectCosts: projectCosts.value,
      distance: distance.value,
      notes: sanitizeDecisionReason(input.notes ?? ""),
    },
  };
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

function normalizeOperationalStatus(status: string) {
  return status === LEGACY_APPROVED_STATUS ? APPROVED_STATUS : status;
}

export function buildHistoricalRow(
  lead: SheetLead,
  closeout: CloseoutValues,
  completedAt: string,
  completedBy: string,
  headers: readonly string[],
) {
  const projectCosts = closeout.projectCosts;
  const netProfit = closeout.finalAmount - projectCosts;
  const roi =
    projectCosts > 0 ? `${(((closeout.finalAmount - projectCosts) / projectCosts) * 100).toFixed(2)}%` : "";
  const values: Record<string, string> = {
    Date: completedAt.slice(0, 10),
    "Job Type": lead.services,
    Amount: formatMoney(closeout.finalAmount),
    Owner: lead.businessOwner || completedBy,
    City: lead.city,
    Payment_Expense: "Payment",
    Distance: closeout.distance === null ? "" : String(closeout.distance),
    "Project Costs": formatMoney(closeout.projectCosts),
    ROI: roi,
    Client: lead.name,
    "Net Profit": formatMoney(netProfit),
    Completed: "1",
    Notes: [
      closeout.notes,
      `Lead ID: ${lead.leadId}`,
      lead.appointmentType ? `Appointment Type: ${lead.appointmentType}` : "",
      lead.projectDescription ? `Project Description: ${lead.projectDescription}` : "",
    ].filter(Boolean).join(" | "),
  };
  return headers.map((header) => escapeSheetCell(values[header] ?? ""));
}

async function appendHistoricalJob(
  lead: SheetLead,
  closeout: CloseoutValues,
  completedAt: string,
  completedBy: string,
) {
  const spreadsheetId = process.env.HISTORICAL_SPREADSHEET_ID || HISTORICAL_SPREADSHEET_ID;
  const sheetName = process.env.HISTORICAL_SHEET_TAB || "Sheet1";
  const token = await getGoogleAccessToken([SHEETS_SCOPE]);
  const headers = await getSheetHeaders(spreadsheetId, sheetName, token);
  const row = buildHistoricalRow(lead, closeout, completedAt, completedBy, headers);

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      sheetName,
    )}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Historical Google Sheets append failed with ${response.status}: ${await response.text()}`,
    );
  }
}
