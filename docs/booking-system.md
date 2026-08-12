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

Target tab: `GOOGLE_SHEET_TAB`, default `Open Leads`

The integration first reads row 1 from the existing tab. Existing columns are
preserved in their current order. Required missing columns are appended to the
end of row 1 so existing dashboard dependencies are not rearranged.

Minimum columns used by the website:

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

The current storage adapter intentionally defaults to `PHOTO_STORAGE_MODE=disabled`.

`PHOTO_STORAGE_MODE=mock` is available for local/preview testing only. It
validates image files and returns non-public mock references. It is not durable
customer-photo storage.

Before launch, configure an approved private object storage provider and extend
`app/lib/booking/storage.ts` to return durable authorized photo references.

## Phase 3 Preparation

Phase 2 records requested times as pending requests only. Future approval can:

1. read the Sheet row by Unique ID
2. re-check Calendar availability
3. create the Google Calendar event if approved
4. update Status to Confirmed or Declined
5. notify the customer

No Calendar events are created by this phase.

