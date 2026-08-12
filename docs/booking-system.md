# Booking System Architecture

The booking system is implemented as a one-question-at-a-time customer intake
flow at `/book`.

Architecture:

Website UI -> Next.js server API -> Google Calendar / Google Sheets / photo storage

The browser never writes directly to Google Sheets and never receives Google
Calendar event details. It only receives customer-facing availability slots.

## API Routes

- `GET /api/booking/availability`
  - server-side rate limited
  - reads Google Calendar free/busy data
  - returns only available request slots

- `POST /api/booking/photos`
  - validates image type, size, and count
  - stores or references photos through the configured storage adapter
  - does not write binary image data into Google Sheets

- `POST /api/booking/submit`
  - validates all required lead fields server-side
  - verifies Turnstile when configured
  - checks honeypot, timing, rate limit, duplicate, and idempotency controls
  - re-checks Calendar free/busy before accepting the requested time
  - appends one structured row to the configured Sheet tab
  - sets `Status = Pending Approval`
  - sets `Source = Website`
  - does not create a Google Calendar event

## Google Sheet Mapping

Target spreadsheet: `GOOGLE_SPREADSHEET_ID`

Fallback supported spreadsheet variable: `GOOGLE_SHEETS_SPREADSHEET_ID`

Target tab: `GOOGLE_SHEET_TAB`, default `Open Leads`

The integration first reads row 1 from the existing tab. Existing columns are
preserved in their current order. Required missing columns are appended to the
end of row 1 so existing dashboard dependencies are not rearranged.

Canonical columns used by new website leads:

- Unique ID
- Created At
- Status
- Name
- Email
- Phone Number
- Street Address
- City
- State
- ZIP Code
- Optional Unit / Gate / Access Notes
- Service Type(s)
- Appointment Type
- Project Description
- Photo URLs / Photo References
- Requested Date
- Requested Time
- Source
- Internal Notes

Legacy duplicate columns such as `ZIP code` and
`Optional unit / gate / access notes` are preserved if they already exist, but
new website lead data is written only to the standardized `ZIP Code` and
`Optional Unit / Gate / Access Notes` columns.

Phase 3 appends these columns when missing. It does not delete, reorder, or
rewrite historical columns:

- Approval / Decision Timestamp
- Google Calendar Event ID
- Confirmed Date
- Confirmed Time
- Decline Reason
- Email Status

## Calendar Rules

Current default rules:

- Opening time: 7:00 AM
- Closing time: 8:00 PM
- Every day of the week
- Timezone: `America/Los_Angeles`
- Appointment duration: `BOOKING_APPOINTMENT_MINUTES`
- Slot interval: `BOOKING_INTERVAL_MINUTES`
- Buffer: `BOOKING_BUFFER_MINUTES`
- Minimum advance notice: `BOOKING_MIN_ADVANCE_HOURS`
- Booking horizon: `BOOKING_HORIZON_DAYS`

These values are centralized in `app/lib/booking/config.ts` and configurable by
environment variables.

## Spam Protection

Layers implemented:

- server-side validation for all important fields
- IP-based in-memory rate limiting on availability, photo upload, and submit APIs
- invisible honeypot field
- minimum submission timing check
- duplicate fingerprint detection for short-window repeated submissions
- idempotency key handling for safe retries
- strict file type, file size, and count validation
- request-size guard for photo uploads
- optional Cloudflare Turnstile verification when `TURNSTILE_SECRET_KEY` is set

Production should use platform-backed rate limiting or durable storage if high
traffic is expected, because in-memory protection resets per server instance.

## Photo Storage

The storage adapter keeps uploads private and only uses durable storage when a
private Vercel Blob store is connected or a storage mode is explicitly set.

`PHOTO_STORAGE_MODE=mock` is available for local/preview testing only. It
validates image files and returns non-public mock references. It is not durable
customer-photo storage.

Recommended Vercel Blob setup:

- Create or connect a private Vercel Blob store to the Vercel project.
- Use the current OIDC project connection when available. The SDK authenticates
  from Vercel Functions without a long-lived `BLOB_READ_WRITE_TOKEN`.
- Ensure the project has `BLOB_STORE_ID`. When that is present, the adapter
  auto-enables Vercel Blob unless `PHOTO_STORAGE_MODE=disabled` is explicitly
  set.
- Optional: set `PHOTO_STORAGE_MODE=vercel-blob` to force Blob uploads.
- Legacy fallback only: `BLOB_READ_WRITE_TOKEN` still works if the store has not
  been upgraded to OIDC.

Uploaded photos are stored as private blobs under a dated `booking-photos/`
prefix and the Sheet receives the Blob pathname/reference. The browser does not
receive a public customer-photo directory URL.

## Google Credentials

Preferred credential variable:

- `GOOGLE_SERVICE_ACCOUNT_JSON`

Fallback split credential variables:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Credential values must remain server-side only. Do not expose or commit them.

## Phase 2 Behavior

Phase 2 records requested times as pending requests only:

- customer request creates a Sheet row
- `Status = Pending Approval`
- no Calendar event is created before owner approval

## Phase 3 Owner Approval

Owner review is available at `/owner/approvals` when `OWNER_APPROVAL_TOKEN` is
configured. The owner submits that token by POST to the server, and the raw
token is never placed in URLs, hidden fields, client-side JavaScript, or the
rendered owner page. Successful login creates signed owner session cookies with
`HttpOnly`, `Secure`, and `SameSite=Strict` attributes. Logout clears the active
session marker and revokes the current session in-process. Owner mutations
require the valid session cookies and reject cross-site browser posts with a
mismatched `Origin` header.

Approve flow:

1. validate owner session
2. load the lead by `Unique ID`
3. require `Status = Pending Approval`
4. re-check Google Calendar free/busy for the requested time
5. look for an existing Calendar event with the lead id
6. create a busy/opaque Calendar event only if none exists
7. update the Sheet with `Status = Approved`, decision timestamp, Calendar
   Event ID, confirmed date, and confirmed time

Decline flow:

1. validate owner session
2. load the lead by `Unique ID`
3. require `Status = Pending Approval`
4. update the Sheet with `Status = Declined`, decision timestamp, and decline
   reason
5. do not create a Calendar event

Email delivery is intentionally not marked successful yet. The current Google
service account is suitable for Calendar/Sheets, but it is not assumed to be
authorized to send mail as Wade Home Services. Phase 3 records email status as
needing configuration until Gmail OAuth/domain delegation or a transactional
email provider is configured.
