import { REQUIRED_SHEET_COLUMNS } from "./config";
import type { BusyWindow } from "./scheduling";
import type { NormalizedLead } from "./types";
import { mapLeadToColumns } from "./validation";

type GoogleToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: GoogleToken | null = null;

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

export function googleConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_SPREADSHEET_ID &&
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
    throw new Error(`Calendar free/busy failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    calendars?: Record<string, { busy?: BusyWindow[] }>;
  };
  return payload.calendars?.[calendarId]?.busy ?? [];
}

export async function appendLeadToSheet(leadId: string, lead: NormalizedLead) {
  const spreadsheetId = requireEnv("GOOGLE_SPREADSHEET_ID");
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
    throw new Error(`Google Sheets append failed with ${response.status}`);
  }
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
    throw new Error(`Google Sheets header read failed with ${response.status}`);
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
    throw new Error(`Google Sheets header update failed with ${response.status}`);
  }
  return headers;
}

async function getGoogleAccessToken(scopes: string[]) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    iss: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
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
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  return cachedToken.accessToken;
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
  const signature = signer.sign(normalizePrivateKey(requireEnv("GOOGLE_PRIVATE_KEY")));
  return `${unsigned}.${base64Url(signature)}`;
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
