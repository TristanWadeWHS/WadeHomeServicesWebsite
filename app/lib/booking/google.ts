import {
  APPROVED_STATUS,
  CONFLICT_STATUS,
  DECLINED_STATUS,
  LEAD_STATUS,
  REQUIRED_SHEET_COLUMNS,
} from "./config";
import type { BusyWindow } from "./scheduling";
import { isSlotStillAvailable } from "./scheduling";
import type { NormalizedLead, OwnerDecisionResult, SheetLead } from "./types";
import { escapeSheetCell, mapLeadToColumns } from "./validation";

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

export async function getPendingLeads() {
  const { headers, rows } = await getSheetRows();
  return rows
    .map((row, index) => sheetRowToLead(headers, row, index + 2))
    .filter((lead) => lead.status === LEAD_STATUS);
}

export async function getLeadById(leadId: string) {
  const { headers, rows } = await getSheetRows();
  const index = rows.findIndex((row) => row[headers.indexOf("Unique ID")] === leadId);
  if (index < 0) return null;
  return sheetRowToLead(headers, rows[index], index + 2);
}

export async function approveLead(leadId: string): Promise<OwnerDecisionResult> {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, message: "Lead not found." };
  if (lead.status === APPROVED_STATUS && lead.calendarEventId) {
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
  const emailStatus = emailNeedsConfigurationStatus();
  const updated = await updateLeadColumns(lead, {
    Status: APPROVED_STATUS,
    "Approval / Decision Timestamp": new Date().toISOString(),
    "Google Calendar Event ID": eventId,
    "Confirmed Date": lead.requestedDate,
    "Confirmed Time": lead.requestedTime,
    "Email Status": emailStatus,
    "Internal Notes": appendInternalNote(
      lead.internalNotes,
      existingEventId
        ? "Owner approved request; existing Calendar event reused."
        : "Owner approved request; Calendar event created.",
    ),
  });

  return {
    ok: true,
    lead: updated,
    calendarEventCreated: !existingEventId,
    emailStatus,
  };
}

export async function declineLead(
  leadId: string,
  reason: string,
): Promise<OwnerDecisionResult> {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, message: "Lead not found." };
  if (lead.status !== LEAD_STATUS) {
    return { ok: false, message: `Lead is ${lead.status}.`, lead };
  }

  const emailStatus = emailNeedsConfigurationStatus();
  const updated = await updateLeadColumns(lead, {
    Status: DECLINED_STATUS,
    "Approval / Decision Timestamp": new Date().toISOString(),
    "Decline Reason": sanitizeDecisionReason(reason),
    "Email Status": emailStatus,
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

function sanitizeDecisionReason(reason: string) {
  return reason.replace(/\s+/g, " ").trim().slice(0, 300) || "No reason provided";
}

function emailNeedsConfigurationStatus() {
  return "Needs configuration: no email provider configured";
}
