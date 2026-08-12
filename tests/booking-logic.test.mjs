import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LEAD_SOURCE, LEAD_STATUS, REQUIRED_SHEET_COLUMNS } from "../app/lib/booking/config.ts";
import { buildCalendarEventResource, googleConfigured } from "../app/lib/booking/google.ts";
import {
  buildAvailabilitySlots,
  isSlotStillAvailable,
} from "../app/lib/booking/scheduling.ts";
import {
  duplicateFingerprint,
  isLikelyDuplicate,
  rateLimit,
} from "../app/lib/booking/security.ts";
import {
  clearedOwnerSessionCookieOptions,
  createOwnerSession,
  isOwnerAuthorized,
  isValidOwnerSession,
  isValidOwnerToken,
  OWNER_SESSION_COOKIE,
  ownerSessionCookieOptions,
  revokeOwnerSession,
} from "../app/lib/booking/ownerAuth.ts";
import {
  createLeadId,
  mapLeadToColumns,
  validateSubmission,
} from "../app/lib/booking/validation.ts";

function validSubmission(overrides = {}) {
  return {
    services: ["Junk Removal", "Light Demolition"],
    appointmentType: "On-Site Estimate",
    address: {
      street: "123 Main St",
      city: "Mission Viejo",
      state: "ca",
      zip: "92691",
      accessNotes: "Gate code provided by phone",
    },
    projectDescription: "Garage cleanout and light teardown work.",
    photos: [
      {
        id: "photo-1",
        name: "garage.jpg",
        url: "mock://photo/garage.jpg",
        size: 1000,
        contentType: "image/jpeg",
      },
    ],
    customer: {
      name: "Test Customer",
      email: "TEST@EXAMPLE.COM",
      phone: "(949) 424-5605",
    },
    requestedSlot: {
      start: "2026-08-13T17:00:00.000Z",
      end: "2026-08-13T19:00:00.000Z",
      label: "Thu, Aug 13, 10:00 AM",
    },
    honeypot: "",
    startedAt: Date.now() - 10_000,
    idempotencyKey: "idem-test",
    ...overrides,
  };
}

test("validates required booking fields and normalizes contact data", () => {
  const result = validateSubmission(validSubmission());
  assert.equal(result.ok, true);
  assert.equal(result.value.normalizedEmail, "test@example.com");
  assert.equal(result.value.normalizedPhone, "9494245605");
  assert.equal(result.value.normalizedAddress.state, "CA");
  assert.deepEqual(result.value.services, ["Junk Removal", "Light Demolition"]);
});

test("rejects invalid service, contact, address, timing, and honeypot while allowing zero photos", () => {
  const result = validateSubmission(
    validSubmission({
      services: ["Bad Service"],
      address: { street: "", city: "", state: "", zip: "bad" },
      photos: [],
      customer: { name: "", email: "bad", phone: "12" },
      honeypot: "bot-filled",
      startedAt: Date.now(),
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.services, /invalid|Select/i);
  assert.match(result.errors.email, /email/i);
  assert.match(result.errors.phone, /phone/i);
  assert.match(result.errors.honeypot, /accepted/i);

  const withoutPhotos = validateSubmission(validSubmission({ photos: [] }));
  assert.equal(withoutPhotos.ok, true);
  assert.equal(withoutPhotos.value.photos.length, 0);
});

test("generates non-sequential Wade Home Services lead IDs", () => {
  const leadId = createLeadId(new Date("2026-08-11T12:00:00Z"));
  assert.match(leadId, /^WHS-20260811-[A-Z2-9]{6}$/);
});

test("maps leads to existing Sheet columns while preserving pending/source fields", () => {
  const result = validateSubmission(validSubmission());
  assert.equal(result.ok, true);
  const row = mapLeadToColumns("WHS-20260811-A7K4P2", result.value, REQUIRED_SHEET_COLUMNS);
  const statusIndex = REQUIRED_SHEET_COLUMNS.indexOf("Status");
  const sourceIndex = REQUIRED_SHEET_COLUMNS.indexOf("Source");
  const serviceIndex = REQUIRED_SHEET_COLUMNS.indexOf("Service Type(s)");
  assert.equal(row[0], "WHS-20260811-A7K4P2");
  assert.equal(row[statusIndex], LEAD_STATUS);
  assert.equal(row[sourceIndex], LEAD_SOURCE);
  assert.equal(row[serviceIndex], "Junk Removal, Light Demolition");
});

test("writes website leads only to canonical Sheet columns", () => {
  const result = validateSubmission(validSubmission());
  assert.equal(result.ok, true);
  const headers = [
    "ZIP code",
    "Optional unit / gate / access notes",
    ...REQUIRED_SHEET_COLUMNS,
  ];
  const row = mapLeadToColumns("WHS-20260811-A7K4P2", result.value, headers);
  assert.equal(row[headers.indexOf("ZIP code")], "");
  assert.equal(row[headers.indexOf("Optional unit / gate / access notes")], "");
  assert.equal(row[headers.indexOf("ZIP Code")], "92691");
  assert.equal(
    row[headers.indexOf("Optional Unit / Gate / Access Notes")],
    "Gate code provided by phone",
  );
});

test("customer-submitted status and source are ignored by Sheet mapping", () => {
  const result = validateSubmission({
    ...validSubmission(),
    status: "Approved",
    source: "Customer",
    calendarEventId: "forged-event",
  });
  assert.equal(result.ok, true);
  const row = mapLeadToColumns("WHS-20260811-A7K4P2", result.value, REQUIRED_SHEET_COLUMNS);
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Status")], LEAD_STATUS);
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Source")], LEAD_SOURCE);
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Google Calendar Event ID")], "");
});

test("owner approval token uses server-side secret", () => {
  const previous = process.env.OWNER_APPROVAL_TOKEN;
  process.env.OWNER_APPROVAL_TOKEN = "owner-secret";
  assert.equal(isValidOwnerToken("owner-secret"), true);
  assert.equal(isValidOwnerToken("wrong-secret"), false);
  assert.equal(isValidOwnerToken(""), false);
  if (previous === undefined) delete process.env.OWNER_APPROVAL_TOKEN;
  else process.env.OWNER_APPROVAL_TOKEN = previous;
});

test("owner page markup cannot serialize raw token in links or hidden form fields", () => {
  const source = readFileSync("app/owner/approvals/page.tsx", "utf8");
  assert.equal(source.includes("searchParams"), false);
  assert.equal(source.includes("?token="), false);
  assert.equal(source.includes('type="hidden" value={token}'), false);
  assert.equal(source.includes('name="token" type="hidden"'), false);
});

test("owner signed session accepts valid cookie and rejects invalid sessions", () => {
  const previous = process.env.OWNER_APPROVAL_TOKEN;
  process.env.OWNER_APPROVAL_TOKEN = "owner-secret";

  const session = createOwnerSession(1_786_000_000_000);
  assert.equal(isValidOwnerSession(session, 1_786_000_010_000), true);
  assert.equal(isValidOwnerSession(`${session}tampered`, 1_786_000_010_000), false);
  assert.equal(isValidOwnerSession(session, 1_786_000_000_000 + 9 * 60 * 60 * 1000), false);

  const currentSession = createOwnerSession();
  const request = new Request("https://example.com/api/owner/booking/approve", {
    headers: { cookie: `${OWNER_SESSION_COOKIE}=${encodeURIComponent(currentSession)}` },
  });
  assert.equal(isOwnerAuthorized(request), true);

  const badRequest = new Request("https://example.com/api/owner/booking/approve", {
    headers: { cookie: `${OWNER_SESSION_COOKIE}=bad-session` },
  });
  assert.equal(isOwnerAuthorized(badRequest), false);

  if (previous === undefined) delete process.env.OWNER_APPROVAL_TOKEN;
  else process.env.OWNER_APPROVAL_TOKEN = previous;
});

test("owner session cookie is HttpOnly, Secure, strict, and logout clears it", () => {
  const previous = process.env.OWNER_APPROVAL_TOKEN;
  process.env.OWNER_APPROVAL_TOKEN = "owner-secret";
  const session = createOwnerSession();
  assert.equal(isValidOwnerSession(session), true);
  revokeOwnerSession(session);
  assert.equal(isValidOwnerSession(session), false);

  const options = ownerSessionCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "strict");
  assert.equal(options.path, "/");

  const cleared = clearedOwnerSessionCookieOptions();
  assert.equal(cleared.httpOnly, true);
  assert.equal(cleared.secure, true);
  assert.equal(cleared.maxAge, 0);

  if (previous === undefined) delete process.env.OWNER_APPROVAL_TOKEN;
  else process.env.OWNER_APPROVAL_TOKEN = previous;
});

test("availability transformation hides private Calendar details and filters busy slots", () => {
  process.env.BOOKING_OPENING_HOUR = "7";
  process.env.BOOKING_CLOSING_HOUR = "10";
  process.env.BOOKING_APPOINTMENT_MINUTES = "60";
  process.env.BOOKING_INTERVAL_MINUTES = "60";
  process.env.BOOKING_MIN_ADVANCE_HOURS = "0";
  process.env.BOOKING_HORIZON_DAYS = "0";
  process.env.BOOKING_TIMEZONE = "America/Los_Angeles";
  const now = new Date("2026-08-11T07:00:00.000Z");
  const busy = [
    {
      start: "2026-08-11T15:00:00.000Z",
      end: "2026-08-11T16:00:00.000Z",
      summary: "Private job",
    },
  ];
  const slots = buildAvailabilitySlots(busy, now);
  assert.ok(slots.length > 0);
  assert.equal(Object.hasOwn(slots[0], "summary"), false);
});

test("busy Calendar interval removes every overlapping availability slot", () => {
  process.env.BOOKING_OPENING_HOUR = "7";
  process.env.BOOKING_CLOSING_HOUR = "13";
  process.env.BOOKING_APPOINTMENT_MINUTES = "120";
  process.env.BOOKING_INTERVAL_MINUTES = "60";
  process.env.BOOKING_MIN_ADVANCE_HOURS = "0";
  process.env.BOOKING_HORIZON_DAYS = "0";
  process.env.BOOKING_TIMEZONE = "America/Los_Angeles";

  const slots = buildAvailabilitySlots(
    [{ start: "2026-08-11T16:00:00.000Z", end: "2026-08-11T18:00:00.000Z" }],
    new Date("2026-08-11T07:00:00.000Z"),
  );

  assert.equal(slots.some((slot) => slot.start === "2026-08-11T14:00:00.000Z"), true);
  assert.equal(slots.some((slot) => slot.start === "2026-08-11T15:00:00.000Z"), false);
  assert.equal(slots.some((slot) => slot.start === "2026-08-11T16:00:00.000Z"), false);
  assert.equal(slots.some((slot) => slot.start === "2026-08-11T17:00:00.000Z"), false);
  assert.equal(slots.some((slot) => slot.start === "2026-08-11T18:00:00.000Z"), true);
});

test("server-side final check rejects a slot that overlaps Calendar busy time", () => {
  const available = isSlotStillAvailable(
    "2026-08-11T08:30:00.000Z",
    "2026-08-11T09:30:00.000Z",
    [{ start: "2026-08-11T09:00:00.000Z", end: "2026-08-11T10:00:00.000Z" }],
  );
  assert.equal(available, false);
});

test("approved Calendar event payload uses opaque busy semantics", () => {
  process.env.BOOKING_TIMEZONE = "America/Los_Angeles";
  const resource = buildCalendarEventResource(
    {
      rowNumber: 2,
      leadId: "WHS-20260812-TEST01",
      createdAt: "2026-08-12T20:00:00.000Z",
      status: "Pending Approval",
      name: "WHS TEST CUSTOMER",
      email: "test@example.com",
      phone: "949-424-5605",
      streetAddress: "123 Test Way",
      city: "Mission Viejo",
      state: "CA",
      zip: "92691",
      accessNotes: "",
      services: "Junk Removal",
      appointmentType: "On-Site Estimate",
      projectDescription: "Test project description.",
      photoReferences: "",
      requestedDate: "2026-08-15",
      requestedTime: "Sat, Aug 15, 10:00 AM",
      source: "Website",
      internalNotes: "",
      decisionTimestamp: "",
      calendarEventId: "",
      confirmedDate: "",
      confirmedTime: "",
      declineReason: "",
      emailStatus: "",
    },
    {
      start: "2026-08-15T17:00:00.000Z",
      end: "2026-08-15T19:00:00.000Z",
    },
  );
  assert.equal(resource.transparency, "opaque");
  assert.equal(resource.start.timeZone, "America/Los_Angeles");
  assert.equal(resource.end.timeZone, "America/Los_Angeles");
  assert.equal(resource.extendedProperties.private.leadId, "WHS-20260812-TEST01");
});

test("rate limit and duplicate fingerprint protections activate", () => {
  const rateKey = `test:${Date.now()}`;
  assert.equal(rateLimit(rateKey, 1, 60_000).ok, true);
  assert.equal(rateLimit(rateKey, 1, 60_000).ok, false);

  const fingerprint = duplicateFingerprint(["TEST@EXAMPLE.COM", "(949) 424-5605", "123 Main"]);
  assert.equal(isLikelyDuplicate(fingerprint), false);
  assert.equal(isLikelyDuplicate(fingerprint), true);
});

test("Google configuration supports service account JSON and spreadsheet fallbacks", () => {
  const previous = {
    json: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    sheetsSpreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    calendarId: process.env.GOOGLE_CALENDAR_ID,
  };

  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "service@example.iam.gserviceaccount.com",
    private_key: "test-private-key",
  });
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
  delete process.env.GOOGLE_SPREADSHEET_ID;
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "spreadsheet-id";
  process.env.GOOGLE_CALENDAR_ID = "calendar-id";

  assert.equal(googleConfigured(), true);

  restoreEnv(previous);
});

function restoreEnv(values) {
  for (const [key, value] of Object.entries({
    GOOGLE_SERVICE_ACCOUNT_JSON: values.json,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: values.email,
    GOOGLE_PRIVATE_KEY: values.privateKey,
    GOOGLE_SPREADSHEET_ID: values.spreadsheetId,
    GOOGLE_SHEETS_SPREADSHEET_ID: values.sheetsSpreadsheetId,
    GOOGLE_CALENDAR_ID: values.calendarId,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
