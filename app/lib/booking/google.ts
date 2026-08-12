import { REQUIRED_SHEET_COLUMNS } from "./config";
import type { BusyWindow } from "./scheduling";
import type { NormalizedLead } from "./types";
import { mapLeadToColumns } from "./validation";

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
