import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLOSED_STATUS,
  LEAD_SOURCE,
  LEAD_STATUS,
  MANUAL_LEAD_SOURCE,
  MANUAL_LEAD_STATUS,
  REQUIRED_SHEET_COLUMNS,
} from "../app/lib/booking/config.ts";
import {
  buildCalendarEventResource,
  buildHistoricalRow,
  googleConfigured,
} from "../app/lib/booking/google.ts";
import {
  buildCustomerConfirmationPayload,
  buildOwnerNotificationPayload,
  ownerApprovalPortalUrl,
  ownerNotificationConfigured,
} from "../app/lib/booking/ownerNotifications.ts";
import {
  buildAvailabilitySlots,
  buildAvailabilitySlotsForDate,
  isSlotStillAvailable,
} from "../app/lib/booking/scheduling.ts";
import {
  duplicateFingerprint,
  isLikelyDuplicate,
  readJsonWithLimit,
  rateLimit,
} from "../app/lib/booking/security.ts";
import {
  clearedOwnerSessionCookieOptions,
  createOperationsSession,
  createOwnerSession,
  getAuthorizedOperationsUser,
  isOwnerAuthorized,
  isSameOriginRequest,
  operationsSessionCookieOptions,
  OPERATIONS_SESSION_ACTIVE_COOKIE,
  OPERATIONS_SESSION_COOKIE,
  requireRole,
  ROLE_FIELD_MANAGER,
  ROLE_OWNER,
  isValidOwnerSession,
  isValidOwnerToken,
  OWNER_SESSION_ACTIVE_COOKIE,
  OWNER_SESSION_COOKIE,
  ownerSessionCookieOptions,
  roleForToken,
  revokeOwnerSession,
  verifyOperationsSession,
} from "../app/lib/booking/ownerAuth.ts";
import {
  createLeadId,
  escapeSheetCell,
  formatPhotoReferences,
  MAX_PHOTO_AGGREGATE_SIZE_BYTES,
  MAX_PHOTO_COUNT,
  MAX_PHOTO_SIZE_BYTES,
  mapLeadToColumns,
  mapManualLeadToColumns,
  parsePhotoReferences,
  validateManualLeadInput,
  validatePhotoFile,
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
        url: "booking-photos/pending/garage.jpg",
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

test("customer-controlled Sheet values are escaped against formula injection", () => {
  const result = validateSubmission(
    validSubmission({
      customer: {
        name: "=HYPERLINK(\"https://evil.example\",\"click\")",
        email: "TEST@EXAMPLE.COM",
        phone: "(949) 424-5605",
      },
      projectDescription: "+cmd|' /C calc'!A0",
    }),
  );
  assert.equal(result.ok, true);

  const row = mapLeadToColumns("WHS-20260811-A7K4P2", result.value, REQUIRED_SHEET_COLUMNS);
  assert.equal(
    row[REQUIRED_SHEET_COLUMNS.indexOf("Name")].startsWith("'="),
    true,
  );
  assert.equal(
    row[REQUIRED_SHEET_COLUMNS.indexOf("Project Description")].startsWith("'+"),
    true,
  );
  assert.equal(escapeSheetCell("@hidden").startsWith("'@"), true);
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
  const source = readFileSync("app/owner/page.tsx", "utf8");
  assert.equal(source.includes("searchParams"), false);
  assert.equal(source.includes("OWNER_APPROVAL_TOKEN"), false);
  assert.equal(source.includes("?token="), false);
  assert.equal(source.includes('type="hidden" value={token}'), false);
  assert.equal(source.includes('name="token" type="hidden"'), false);
});

test("owner approval actions are handled by the client instead of raw API form navigation", () => {
  const pageSource = readFileSync("app/owner/page.tsx", "utf8");
  const clientSource = readFileSync("app/owner/OwnerApprovalsClient.tsx", "utf8");

  assert.equal(pageSource.includes('action="/api/owner/booking/approve"'), false);
  assert.equal(pageSource.includes('action="/api/owner/booking/decline"'), false);
  assert.equal(clientSource.includes("fetch(`/api/owner/booking/${action}`"), true);
  assert.equal(clientSource.includes('credentials: "same-origin"'), true);
  assert.equal(clientSource.includes("Appointment approved and added to Google Calendar."), true);
  assert.equal(clientSource.includes("This requested time is no longer available."), true);
});

test("legacy owner approvals route redirects to canonical owner portal", () => {
  const source = readFileSync("app/owner/approvals/page.tsx", "utf8");
  assert.equal(source.includes('redirect("/login")'), true);
  assert.equal(source.includes("OWNER_APPROVAL_TOKEN"), false);
  assert.equal(source.includes("?token="), false);
});

test("operations portal uses owner-only workflow tabs", () => {
  const clientSource = readFileSync("app/login/OperationsPortalClient.tsx", "utf8");

  assert.equal(clientSource.includes('role="tablist"'), true);
  assert.equal(clientSource.includes('role="tab"'), true);
  assert.equal(clientSource.includes("Requests"), true);
  assert.equal(clientSource.includes("Active Jobs"), true);
  assert.equal(clientSource.includes("Leads"), true);
  assert.equal(clientSource.includes("+ Add Lead"), true);
  assert.equal(clientSource.includes('useState<PortalTab>(isOwner ? "requests" : "active")'), true);
  assert.equal(clientSource.includes('activeTab === "requests"'), true);
  assert.equal(clientSource.includes('activeTab === "active"'), true);
  assert.equal(clientSource.includes('activeTab === "leads"'), true);
  assert.equal(clientSource.includes("isOwner ? ("), true);
});

test("operations login uses password wording without changing submit action", () => {
  const source = readFileSync("app/login/page.tsx", "utf8");

  assert.equal(source.includes("<span>Password</span>"), true);
  assert.equal(source.includes("Access token"), false);
  assert.equal(source.includes("Open Operations Portal"), true);
  assert.equal(source.includes('action="/api/session/login"'), true);
});

test("mobile header has collapsible navigation without changing desktop nav destinations", () => {
  const shellSource = readFileSync("app/components/SiteShell.tsx", "utf8");
  const cssSource = readFileSync("app/globals.css", "utf8");

  assert.equal(shellSource.includes("mobile-menu-toggle"), true);
  assert.equal(shellSource.includes("mobile-nav-panel"), true);
  assert.equal(shellSource.includes("aria-expanded={mobileNavOpen}"), true);
  assert.equal(shellSource.includes("setMobileNavOpen(false)"), true);
  assert.equal(shellSource.includes("document.addEventListener(\"pointerdown\""), true);
  assert.equal(shellSource.includes('href="tel:+19494245605"'), true);
  assert.equal(cssSource.includes("@media (max-width: 980px)"), true);
  assert.equal(cssSource.includes(".site-nav,"), true);
  assert.equal(cssSource.includes('prefers-reduced-motion: reduce'), true);
});

test("manual owner leads use canonical sheet columns and owner-only API", () => {
  const routeSource = readFileSync("app/api/owner/leads/route.ts", "utf8");
  const loginSource = readFileSync("app/login/page.tsx", "utf8");
  const googleSource = readFileSync("app/lib/booking/google.ts", "utf8");

  assert.equal(routeSource.includes("requireRole(request, ROLE_OWNER)"), true);
  assert.equal(routeSource.includes("validateManualLeadInput"), true);
  assert.equal(routeSource.includes("sendOwnerNewLeadNotification"), false);
  assert.equal(routeSource.includes("createCalendarEvent"), false);
  assert.equal(loginSource.includes("getManualLeads"), true);
  assert.equal(googleSource.includes("getManualLeads"), true);
  assert.equal(googleSource.includes("MANUAL_LEAD_STATUS"), true);

  const result = validateManualLeadInput({
    name: "=Prospect",
    opportunityInfo: "+Garage cleanout lead",
    phone: "",
    email: "",
    streetAddress: "@Address",
    city: "Mission Viejo",
    notes: "-Call next week",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const row = mapManualLeadToColumns("WHS-20260905-MANUAL", result.value, REQUIRED_SHEET_COLUMNS);
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Status")], MANUAL_LEAD_STATUS);
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Source")], MANUAL_LEAD_SOURCE);
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Name")], "'=Prospect");
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Project Description")], "'+Garage cleanout lead");
  assert.equal(row[REQUIRED_SHEET_COLUMNS.indexOf("Internal Notes")], "Manual owner lead. -Call next week");
});

test("manual lead conversion and decline are owner-only persisted transitions", () => {
  const clientSource = readFileSync("app/login/OperationsPortalClient.tsx", "utf8");
  const convertRoute = readFileSync("app/api/owner/leads/convert/route.ts", "utf8");
  const declineRoute = readFileSync("app/api/owner/leads/decline/route.ts", "utf8");
  const googleSource = readFileSync("app/lib/booking/google.ts", "utf8");

  assert.equal(clientSource.includes("Convert to Active Job"), true);
  assert.equal(clientSource.includes('onUpdate(lead.leadId, "convert", { approvedAmount })'), true);
  assert.equal(clientSource.includes("Decline Lead"), true);
  assert.equal(clientSource.includes("Lead converted to active job."), true);
  assert.equal(clientSource.includes("Lead declined."), true);
  assert.equal(clientSource.includes("Linked Job"), true);
  assert.equal(clientSource.includes("Decision"), true);
  assert.equal(clientSource.includes("Decline Reason"), true);
  assert.equal(clientSource.includes("setManualLeads"), true);
  assert.equal(clientSource.includes("setJobLeads"), true);

  assert.equal(convertRoute.includes("requireRole(request, ROLE_OWNER)"), true);
  assert.equal(declineRoute.includes("requireRole(request, ROLE_OWNER)"), true);
  assert.equal(convertRoute.includes("isSameOriginRequest"), true);
  assert.equal(declineRoute.includes("isSameOriginRequest"), true);
  assert.equal(convertRoute.includes("convertManualLeadToActiveJob"), true);
  assert.equal(convertRoute.includes('form.get("approvedAmount")'), true);
  assert.equal(declineRoute.includes("declineManualLead"), true);
  assert.equal(convertRoute.includes("jsonError(\"Lead could not be converted safely.\""), true);
  assert.equal(declineRoute.includes("jsonError(\"Lead could not be declined safely.\""), true);

  assert.equal(googleSource.includes("export async function convertManualLeadToActiveJob"), true);
  assert.equal(googleSource.includes('parseNonNegativeMoney(approvedAmountValue, "Approved amount")'), true);
  assert.equal(googleSource.includes('"Approved Amount": formatMoney(approvedAmount.value)'), true);
  assert.equal(googleSource.includes("export async function declineManualLead"), true);
  assert.equal(googleSource.includes("lead.status === APPROVED_STATUS && lead.operationalStatus === APPROVED_STATUS"), true);
  assert.equal(googleSource.includes("lead.status === DECLINED_STATUS"), true);
  assert.equal(googleSource.includes("lead.status !== MANUAL_LEAD_STATUS"), true);
  assert.equal(googleSource.includes("Linked job ID: ${lead.leadId}"), true);
  assert.equal(googleSource.includes("Conversion timestamp: ${timestamp}"), true);
  assert.equal(googleSource.includes('"Operational Status": APPROVED_STATUS'), true);
  assert.equal(googleSource.includes('"Operational Status": DECLINED_STATUS'), true);
  assert.equal(googleSource.includes('"Decline Reason": declineReason'), true);
  assert.equal(googleSource.includes("sendOwnerNewLeadNotification"), false);
});

test("operations Sheet schema includes owner and close metadata without duplicate owner columns", () => {
  assert.equal(REQUIRED_SHEET_COLUMNS.includes("Owner"), true);
  assert.equal(REQUIRED_SHEET_COLUMNS.filter((column) => column === "Owner").length, 1);
  assert.equal(REQUIRED_SHEET_COLUMNS.includes("Closed At"), true);
  assert.equal(REQUIRED_SHEET_COLUMNS.includes("Closed By"), true);
  assert.equal(REQUIRED_SHEET_COLUMNS.includes("Close Reason"), true);
  assert.equal(CLOSED_STATUS, "Closed");
});

test("approval requires approved amount and business owner in UI and server path", () => {
  const clientSource = readFileSync("app/login/OperationsPortalClient.tsx", "utf8");
  const routeSource = readFileSync("app/api/owner/booking/approve/route.ts", "utf8");
  const googleSource = readFileSync("app/lib/booking/google.ts", "utf8");

  assert.equal(clientSource.includes("businessOwner"), true);
  assert.equal(clientSource.includes("<span>Owner</span>"), true);
  assert.equal(routeSource.includes('form.get("businessOwner")'), true);
  assert.equal(routeSource.includes("approvedAmount,"), true);
  assert.equal(routeSource.includes("businessOwner,"), true);
  assert.equal(googleSource.includes('sanitizeRequiredText(businessOwnerValue, "Owner", 120)'), true);
  assert.equal(googleSource.includes("Owner: businessOwner.value"), true);
  assert.equal(googleSource.includes("Owner: ${businessOwner.value}"), true);
});

test("completion uses stored owner and does not let field manager overwrite it", () => {
  const clientSource = readFileSync("app/login/OperationsPortalClient.tsx", "utf8");
  const routeSource = readFileSync("app/api/operations/job/complete/route.ts", "utf8");
  const googleSource = readFileSync("app/lib/booking/google.ts", "utf8");

  assert.equal(clientSource.includes("hasStoredOwner"), true);
  assert.equal(clientSource.includes("operations-owner-context"), true);
  assert.equal(clientSource.includes('owner: hasStoredOwner ? "" : fallbackOwner'), true);
  assert.equal(routeSource.includes('form.get("owner")'), true);
  assert.equal(googleSource.includes("const existingOwner = lead.businessOwner.trim()"), true);
  assert.match(googleSource, /const ownerUpdate(?:: Record<string, string>)? = existingOwner \? \{\} : \{ Owner: businessOwner \}/);
  assert.equal(googleSource.includes("const leadForHistorical = { ...lead, businessOwner }"), true);
});

test("legacy active jobs require fallback owner before historical transfer", () => {
  const clientSource = readFileSync("app/login/OperationsPortalClient.tsx", "utf8");
  const googleSource = readFileSync("app/lib/booking/google.ts", "utf8");

  assert.equal(clientSource.includes("setFallbackOwner"), true);
  assert.equal(clientSource.includes("required"), true);
  assert.equal(googleSource.includes('sanitizeRequiredText(input.owner ?? "", "Owner", 120)'), true);
  assert.equal(googleSource.includes('if (fallbackOwner?.ok === false)'), true);
  assert.equal(googleSource.includes("...ownerUpdate"), true);
  assert.equal(googleSource.includes("Owner: ${businessOwner}"), true);
});

test("close request workflow is owner-only and terminal", () => {
  const clientSource = readFileSync("app/login/OperationsPortalClient.tsx", "utf8");
  const routeSource = readFileSync("app/api/owner/booking/close/route.ts", "utf8");
  const googleSource = readFileSync("app/lib/booking/google.ts", "utf8");

  assert.equal(clientSource.includes("Close Request"), true);
  assert.equal(clientSource.includes("Customer cancelled"), true);
  assert.equal(clientSource.includes("Test record"), true);
  assert.equal(routeSource.includes("requireRole(request, ROLE_OWNER)"), true);
  assert.equal(routeSource.includes("closeLead"), true);
  assert.equal(googleSource.includes("Status: CLOSED_STATUS"), true);
  assert.equal(googleSource.includes('"Closed At": timestamp'), true);
  assert.equal(googleSource.includes('"Closed By": closedBy'), true);
  assert.equal(googleSource.includes('"Close Reason": reason'), true);
  assert.equal(googleSource.includes("calendarEventCreated: false"), true);
  assert.equal(googleSource.includes("lead.status !== LEAD_STATUS && lead.status !== CONFLICT_STATUS"), true);
});

test("operations sessions support owner and field manager roles without exposing tokens", () => {
  const previous = {
    owner: process.env.OWNER_APPROVAL_TOKEN,
    field: process.env.FIELD_MANAGER_ACCESS_TOKEN,
  };
  process.env.OWNER_APPROVAL_TOKEN = "owner-secret";
  process.env.FIELD_MANAGER_ACCESS_TOKEN = "field-secret";

  assert.deepEqual(roleForToken("owner-secret"), { role: ROLE_OWNER, label: "Owner" });
  assert.deepEqual(roleForToken("field-secret"), {
    role: ROLE_FIELD_MANAGER,
    label: "Field Manager",
  });
  assert.equal(roleForToken("wrong"), null);

  const session = createOperationsSession({ role: ROLE_FIELD_MANAGER, label: "Field Manager" });
  assert.deepEqual(verifyOperationsSession(session), {
    role: ROLE_FIELD_MANAGER,
    label: "Field Manager",
  });
  const request = new Request("https://wade.example/api/operations/job/status", {
    headers: {
      cookie: [
        `${OPERATIONS_SESSION_COOKIE}=${encodeURIComponent(session)}`,
        `${OPERATIONS_SESSION_ACTIVE_COOKIE}=1`,
      ].join("; "),
    },
  });
  assert.equal(getAuthorizedOperationsUser(request).role, ROLE_FIELD_MANAGER);
  assert.equal(requireRole(request, ROLE_OWNER).ok, false);
  assert.equal(requireRole(request, ROLE_FIELD_MANAGER).ok, true);

  const options = operationsSessionCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "strict");

  restoreOperationsEnv(previous);
});

test("photo limits enforce Version 4.4 count, size, aggregate, and private-reference requirements", () => {
  assert.equal(MAX_PHOTO_COUNT, 10);
  assert.equal(MAX_PHOTO_SIZE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_PHOTO_AGGREGATE_SIZE_BYTES, 50 * 1024 * 1024);
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  assert.equal(validatePhotoFile(file), null);
  const badFile = new File(["x"], "photo.gif", { type: "image/gif" });
  assert.match(validatePhotoFile(badFile), /JPG|PNG|WEBP|HEIC|HEIF/);
  const tooLargeFile = new File([new Uint8Array(MAX_PHOTO_SIZE_BYTES + 1)], "large.jpg", {
    type: "image/jpeg",
  });
  assert.match(validatePhotoFile(tooLargeFile), /10 MB/);

  const tooMany = validateSubmission(validSubmission({
    photos: Array.from({ length: 11 }, (_, index) => ({
      id: `photo-${index}`,
      name: `photo-${index}.jpg`,
      url: `booking-photos/pending/photo-${index}.jpg`,
      size: 1000,
      contentType: "image/jpeg",
    })),
  }));
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors.photos, /10 photos/);

  const tooMuchAggregate = validateSubmission(validSubmission({
    photos: Array.from({ length: 6 }, (_, index) => ({
      id: `photo-${index}`,
      name: `photo-${index}.jpg`,
      url: `booking-photos/pending/photo-${index}.jpg`,
      size: 9 * 1024 * 1024,
      contentType: "image/jpeg",
    })),
  }));
  assert.equal(tooMuchAggregate.ok, false);
  assert.match(tooMuchAggregate.errors.photos, /50 MB/);

  const publicPhoto = validateSubmission(validSubmission({
    photos: [{
      id: "public-photo",
      name: "public.jpg",
      url: "https://blob.example/public.jpg",
      size: 1000,
      contentType: "image/jpeg",
    }],
  }));
  assert.equal(publicPhoto.ok, false);
  assert.match(publicPhoto.errors["photo-0"], /private/);
});

test("lead photo association stores private metadata instead of public image data", () => {
  const photos = [{
    id: "booking-photos/leads/WHS-20260827-ABC123/photo.jpg",
    name: "project.jpg",
    url: "booking-photos/leads/WHS-20260827-ABC123/photo.jpg",
    size: 1234,
    contentType: "image/jpeg",
  }];
  const serialized = formatPhotoReferences(photos);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("data:image"), false);
  const parsed = parsePhotoReferences(serialized);
  assert.deepEqual(parsed, photos);

  const result = validateSubmission(validSubmission({ photos }));
  assert.equal(result.ok, true);
  const row = mapLeadToColumns("WHS-20260827-ABC123", result.value, REQUIRED_SHEET_COLUMNS);
  const sheetValue = row[REQUIRED_SHEET_COLUMNS.indexOf("Photo URLs / Photo References")];
  assert.match(sheetValue, /booking-photos\/leads\/WHS-20260827-ABC123/);
  assert.equal(sheetValue.includes("data:image"), false);
});

test("photo access route requires authenticated operations roles and private Blob reads", () => {
  const routeSource = readFileSync("app/api/operations/photos/route.ts", "utf8");
  assert.equal(routeSource.includes("requireAnyRole"), true);
  assert.equal(routeSource.includes("ROLE_OWNER"), true);
  assert.equal(routeSource.includes("ROLE_FIELD_MANAGER"), true);
  assert.equal(routeSource.includes("getLeadById"), true);
  assert.equal(routeSource.includes("getPrivatePhoto"), true);
  assert.equal(routeSource.includes("booking-photos/leads/${lead.leadId}/"), true);
  assert.equal(routeSource.includes("BLOB_READ_WRITE_TOKEN"), false);

  const portalSource = readFileSync("app/login/OperationsPortalClient.tsx", "utf8");
  assert.equal(portalSource.includes("/api/operations/photos?leadId="), true);
  assert.equal(portalSource.includes("lead.photoReferences ||"), false);
  assert.equal(portalSource.includes("https://"), false);
});

test("booking photo upload uses private Blob client uploads with structured route errors", () => {
  const routeSource = readFileSync("app/api/booking/photos/route.ts", "utf8");
  const clientSource = readFileSync("app/components/booking/BookingFlow.tsx", "utf8");
  const nextConfigSource = readFileSync("next.config.ts", "utf8");

  assert.equal(routeSource.includes("handleUpload"), true);
  assert.equal(routeSource.includes("request.formData()"), false);
  assert.equal(routeSource.includes("allowedContentTypes"), true);
  assert.equal(routeSource.includes("maximumSizeInBytes: MAX_PHOTO_SIZE_BYTES"), true);
  assert.equal(routeSource.includes("onUploadCompleted"), false);
  assert.equal(routeSource.includes('access: "private"'), false);
  assert.equal(routeSource.includes("safePhotoUploadError"), true);
  assert.equal(routeSource.includes("jsonError(safeError.message"), true);

  assert.equal(clientSource.includes('@vercel/blob/client'), true);
  assert.equal(clientSource.includes('access: "private"'), true);
  assert.equal(clientSource.includes('handleUploadUrl: "/api/booking/photos"'), true);
  assert.equal(clientSource.includes("readJsonResponse"), true);
  assert.equal(clientSource.includes("const json = await response.json();"), false);
  assert.equal(clientSource.includes("readablePhotoUploadError"), true);
  assert.equal(nextConfigSource.includes("connect-src 'self' https://challenges.cloudflare.com https://vercel.com"), true);
});

test("historical completion row maps financial fields without mutating source headers", () => {
  const headers = [
    "Date",
    "Job Type",
    "Amount",
    "Owner",
    "City",
    "Payment_Expense",
    "Distance",
    "Project Costs",
    "ROI",
    "Client",
    "Net Profit",
    "Completed",
    "Notes",
  ];
  const row = buildHistoricalRow(
    sheetLeadFixture(),
    {
      finalAmount: 500,
      projectCosts: 125,
      distance: 12.5,
      notes: "Finished cleanout.",
    },
    "2026-08-20T19:30:00.000Z",
    "Field Manager",
    headers,
  );
  assert.equal(row[headers.indexOf("Date")], "2026-08-20");
  assert.equal(row[headers.indexOf("Owner")], "Tristan Wade");
  assert.equal(row[headers.indexOf("Amount")], "500.00");
  assert.equal(row[headers.indexOf("Project Costs")], "125.00");
  assert.equal(row[headers.indexOf("ROI")], "300.00%");
  assert.equal(row[headers.indexOf("Net Profit")], "375.00");
  assert.equal(row[headers.indexOf("Completed")], "1");
  assert.match(row[headers.indexOf("Notes")], /Lead ID: WHS-20260812-TEST01/);
});

test("historical completion row supports legacy fallback owner without fabricating approved amount", () => {
  const headers = ["Amount", "Owner", "Completed"];
  const legacyLead = {
    ...sheetLeadFixture(),
    approvedAmount: "",
    businessOwner: "Tristan Wade",
  };
  const row = buildHistoricalRow(
    legacyLead,
    {
      finalAmount: 625,
      projectCosts: 250,
      distance: null,
      notes: "Legacy owner fallback.",
    },
    "2026-08-20T19:30:00.000Z",
    "Field Manager",
    headers,
  );

  assert.equal(row[headers.indexOf("Amount")], "625.00");
  assert.equal(row[headers.indexOf("Owner")], "Tristan Wade");
  assert.equal(row[headers.indexOf("Completed")], "1");
});

test("JSON body reader enforces size limits before validation", async () => {
  const small = new Request("https://example.com/api/booking/submit", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
    headers: { "content-type": "application/json" },
  });
  const parsed = await readJsonWithLimit(small, 1024);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.ok, true);

  const large = new Request("https://example.com/api/booking/submit", {
    method: "POST",
    body: JSON.stringify({ text: "x".repeat(2048) }),
    headers: { "content-type": "application/json" },
  });
  const rejected = await readJsonWithLimit(large, 512);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 413);
});

test("owner notification configuration requires server-side email settings", () => {
  const previous = {
    apiKey: process.env.BREVO_API_KEY,
    to: process.env.OWNER_NOTIFICATION_EMAIL,
    portalUrl: process.env.OWNER_APPROVAL_PORTAL_URL,
  };

  delete process.env.BREVO_API_KEY;
  process.env.OWNER_NOTIFICATION_EMAIL = "owner@example.com";
  process.env.OWNER_APPROVAL_PORTAL_URL = "https://www.wadehomeservices.com/owner";
  assert.equal(ownerNotificationConfigured(), false);

  process.env.BREVO_API_KEY = "xkeysib-test";
  assert.equal(ownerNotificationConfigured(), true);

  restoreEmailEnv(previous);
});

test("owner notification portal URL prefers configured owner URL and falls back to /owner", () => {
  const previous = {
    ownerPortal: process.env.OWNER_APPROVAL_PORTAL_URL,
    publicSite: process.env.NEXT_PUBLIC_SITE_URL,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    vercelUrl: process.env.VERCEL_URL,
  };

  process.env.OWNER_APPROVAL_PORTAL_URL = "https://www.wadehomeservices.com/owner";
  assert.equal(ownerApprovalPortalUrl(), "https://www.wadehomeservices.com/owner");

  delete process.env.OWNER_APPROVAL_PORTAL_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example.com/";
  assert.equal(ownerApprovalPortalUrl(), "https://preview.example.com/owner");

  delete process.env.NEXT_PUBLIC_SITE_URL;
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "wadehomeservices.com";
  delete process.env.VERCEL_URL;
  assert.equal(ownerApprovalPortalUrl(), "https://wadehomeservices.com/owner");

  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  assert.equal(ownerApprovalPortalUrl(), "/owner");

  restoreOwnerPortalEnv(previous);
});

test("Brevo owner notification payload includes required lead details and no customer recipient", () => {
  const validation = validateSubmission(
    validSubmission({
      services: ["Junk Removal", "Storage / Relocation"],
      appointmentType: "Service Appointment Request",
      address: {
        street: "456 Brevo Test Lane",
        city: "Mission Viejo",
        state: "CA",
        zip: "92691",
        accessNotes: "",
      },
      customer: {
        name: "Owner Email Test Customer",
        email: "customer@example.com",
        phone: "949-424-5605",
      },
      projectDescription: "VERSION 4.1 BREVO TEST BOOKING content verification.",
      requestedSlot: {
        start: "2026-08-20T22:00:00.000Z",
        end: "2026-08-21T00:00:00.000Z",
        label: "Thu, Aug 20, 3:00 PM",
      },
    }),
  );
  assert.equal(validation.ok, true);

  const payload = buildOwnerNotificationPayload(
    "WHS-20260820-ABC123",
    validation.value,
    "https://www.wadehomeservices.com/owner",
    "owner@example.com",
  );
  const combinedContent = `${payload.htmlContent}\n${payload.textContent}`;

  assert.deepEqual(payload.sender, {
    email: "WadeHomeServices@yahoo.com",
    name: "Wade Home Services",
  });
  assert.deepEqual(payload.to, [{ email: "owner@example.com" }]);
  assert.equal(payload.to.some((recipient) => recipient.email === "customer@example.com"), false);
  assert.equal(payload.subject, "New Wade Home Services Booking Request");
  assert.match(combinedContent, /WHS-20260820-ABC123/);
  assert.match(combinedContent, /Owner Email Test Customer/);
  assert.match(combinedContent, /customer@example\.com/);
  assert.match(combinedContent, /949-424-5605/);
  assert.match(combinedContent, /456 Brevo Test Lane/);
  assert.match(combinedContent, /Mission Viejo/);
  assert.match(combinedContent, /CA/);
  assert.match(combinedContent, /92691/);
  assert.match(combinedContent, /Junk Removal, Storage \/ Relocation/);
  assert.match(combinedContent, /Service Appointment Request/);
  assert.match(combinedContent, /VERSION 4\.1 BREVO TEST BOOKING/);
  assert.match(combinedContent, /2026-08-20/);
  assert.match(combinedContent, /Thu, Aug 20, 3:00 PM/);
  assert.match(combinedContent, /Review Request/);
  assert.match(combinedContent, /https:\/\/www\.wadehomeservices\.com\/owner/);
  assert.equal(combinedContent.includes("OWNER_APPROVAL_TOKEN"), false);
  assert.equal(combinedContent.includes("?token="), false);
});

test("booking request time uses date and time dropdowns from availability slots", () => {
  const source = readFileSync("app/components/booking/BookingFlow.tsx", "utf8");

  assert.equal(source.includes("Preferred Date"), true);
  assert.equal(source.includes("Preferred Time"), true);
  assert.equal(source.includes('type="date"'), true);
  assert.equal(source.includes("todayDateValue"), true);
  assert.equal(source.includes("setSelectedDate"), true);
  assert.equal(source.includes("/api/booking/availability?date="), true);
  assert.equal(source.includes("Refresh Available Times"), true);
  assert.equal(source.includes("No times are available for this date."), true);
  assert.equal(source.includes("This does not confirm the appointment"), true);
  assert.equal(source.includes("slot-button"), false);
});

test("Brevo customer confirmation payload includes confirmed appointment details", () => {
  const lead = sheetLeadFixture({
    leadId: "WHS-20260825-CONF01",
    name: "Customer Confirmation Test",
    email: "customer-confirmation@example.com",
    streetAddress: "789 Confirmation Way",
    services: "Junk Removal, Light Demolition",
    confirmedDate: "2026-08-25",
    confirmedTime: "Tue, Aug 25, 2:00 PM",
  });
  const payload = buildCustomerConfirmationPayload(lead);
  const combinedContent = `${payload.htmlContent}\n${payload.textContent}`;

  assert.deepEqual(payload.to, [{
    email: "customer-confirmation@example.com",
    name: "Customer Confirmation Test",
  }]);
  assert.equal(payload.subject, "Your Wade Home Services Appointment Is Confirmed");
  assert.match(combinedContent, /appointment is confirmed/i);
  assert.match(combinedContent, /WHS-20260825-CONF01/);
  assert.match(combinedContent, /2026-08-25/);
  assert.match(combinedContent, /Tue, Aug 25, 2:00 PM/);
  assert.match(combinedContent, /Junk Removal, Light Demolition/);
  assert.match(combinedContent, /789 Confirmation Way/);
  assert.match(combinedContent, /949-424-5605/);
  assert.equal(combinedContent.includes("BREVO_API_KEY"), false);
});

test("customer confirmation is sent only after approval succeeds", () => {
  const approvalSource = readFileSync("app/lib/booking/google.ts", "utf8");
  const submitSource = readFileSync("app/api/booking/submit/route.ts", "utf8");
  const declineSource = readFileSync("app/api/owner/booking/decline/route.ts", "utf8");
  const approvalUpdateIndex = approvalSource.indexOf("const updated = await updateLeadColumns(lead");
  const confirmationIndex = approvalSource.indexOf("safeSendCustomerApprovalConfirmation(updated)");

  assert.ok(approvalUpdateIndex > -1);
  assert.ok(confirmationIndex > approvalUpdateIndex);
  assert.equal(approvalSource.includes("Customer confirmation pending."), true);
  assert.equal(approvalSource.includes("customerConfirmationEmailStatus"), true);
  assert.equal(approvalSource.includes("logCustomerConfirmationFailure"), true);
  assert.equal(approvalSource.includes("sendCustomerApprovalConfirmation"), true);
  assert.equal(submitSource.includes("sendCustomerApprovalConfirmation"), false);
  assert.equal(declineSource.includes("sendCustomerApprovalConfirmation"), false);
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
    headers: {
      cookie: [
        `${OWNER_SESSION_COOKIE}=${encodeURIComponent(currentSession)}`,
        `${OWNER_SESSION_ACTIVE_COOKIE}=1`,
      ].join("; "),
    },
  });
  assert.equal(isOwnerAuthorized(request), true);

  const badRequest = new Request("https://example.com/api/owner/booking/approve", {
    headers: {
      cookie: `${OWNER_SESSION_COOKIE}=bad-session; ${OWNER_SESSION_ACTIVE_COOKIE}=1`,
    },
  });
  assert.equal(isOwnerAuthorized(badRequest), false);

  const loggedOutRequest = new Request("https://example.com/api/owner/booking/approve", {
    headers: { cookie: `${OWNER_SESSION_COOKIE}=${encodeURIComponent(currentSession)}` },
  });
  assert.equal(isOwnerAuthorized(loggedOutRequest), false);

  if (previous === undefined) delete process.env.OWNER_APPROVAL_TOKEN;
  else process.env.OWNER_APPROVAL_TOKEN = previous;
});

test("owner mutation origin guard rejects cross-site browser posts", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("https://wade.example/api/owner/booking/approve", {
        headers: { origin: "https://wade.example" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(
      new Request("https://wade.example/api/owner/booking/approve", {
        headers: { origin: "https://evil.example" },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOriginRequest(new Request("https://wade.example/api/owner/booking/approve")),
    true,
  );
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

test("date-specific availability supports future dates beyond the default horizon", () => {
  process.env.BOOKING_OPENING_HOUR = "7";
  process.env.BOOKING_CLOSING_HOUR = "10";
  process.env.BOOKING_APPOINTMENT_MINUTES = "60";
  process.env.BOOKING_INTERVAL_MINUTES = "60";
  process.env.BOOKING_MIN_ADVANCE_HOURS = "0";
  process.env.BOOKING_HORIZON_DAYS = "0";
  process.env.BOOKING_TIMEZONE = "America/Los_Angeles";

  const now = new Date("2026-08-11T07:00:00.000Z");
  const slots = buildAvailabilitySlotsForDate("2026-09-15", [], now);

  assert.equal(slots.length, 3);
  assert.equal(slots.every((slot) => slot.dateLabel === "Tuesday, September 15"), true);
  assert.equal(slots[0].label, "Tue, Sep 15, 7:00 AM");
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
      photos: [],
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

function restoreEmailEnv(values) {
  for (const [key, value] of Object.entries({
    BREVO_API_KEY: values.apiKey,
    OWNER_NOTIFICATION_EMAIL: values.to,
    OWNER_APPROVAL_PORTAL_URL: values.portalUrl,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreOwnerPortalEnv(values) {
  for (const [key, value] of Object.entries({
    OWNER_APPROVAL_PORTAL_URL: values.ownerPortal,
    NEXT_PUBLIC_SITE_URL: values.publicSite,
    VERCEL_PROJECT_PRODUCTION_URL: values.productionUrl,
    VERCEL_URL: values.vercelUrl,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreOperationsEnv(values) {
  for (const [key, value] of Object.entries({
    OWNER_APPROVAL_TOKEN: values.owner,
    FIELD_MANAGER_ACCESS_TOKEN: values.field,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function sheetLeadFixture(overrides = {}) {
  return {
    rowNumber: 2,
    leadId: "WHS-20260812-TEST01",
    createdAt: "2026-08-12T20:00:00.000Z",
    status: "Approved / Scheduled",
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
    photos: [],
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
    approvedAmount: "",
    businessOwner: "Tristan Wade",
    operationalStatus: "",
    completedAt: "",
    completionFinalAmount: "",
    projectCosts: "",
    distance: "",
    completionNotes: "",
    closedAt: "",
    closedBy: "",
    closeReason: "",
    historicalTransferStatus: "",
    historicalTransferTimestamp: "",
    auditTrail: "",
    ...overrides,
  };
}
