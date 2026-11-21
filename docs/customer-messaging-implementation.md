# WHS customer messaging — implementation plan (draft, no live sends)

## Current confirmed architecture
- Website is Next.js with owner booking/lead workflows under `app/lib/booking`.
- Lead and appointment state uses Google Sheets and Google Calendar; see `app/lib/booking/config.ts`.
- Brevo transactional email integration already exists at `app/lib/booking/ownerNotifications.ts`.
- New `app/lib/messaging/consent.ts` is a pure, fail-closed policy module only. It does not collect consent or send messages.

## Proposed storage (append-only consent ledger and outbox)
Use durable transactional storage (e.g., Postgres) before enabling automated sends. Do not use in-memory timers or only Google Sheets for deduplication.

- `customers`: id, name, phone_e164, email, created_at, updated_at.
- `appointments`: id, lead_id, customer_id, calendar_event_id, start_at, end_at, timezone, status, version.
- `consent_events`: id, customer_id, channel, purpose, state, source, recorded_at, disclosure_version, disclosure_text_snapshot, evidence_reference, recorded_by.
- `message_outbox`: id, customer_id, appointment_id, channel, purpose, template_key, appointment_version, idempotency_key UNIQUE, scheduled_for, state, provider_message_id, attempt_count, last_error_code, created_at, updated_at.
- `message_events`: id, outbox_id, provider_event_id UNIQUE, event_type, occurred_at, received_at, metadata_redacted.
- `suppression`: customer_id, channel, reason, created_at, UNIQUE(customer_id, channel).

## Owner Portal
- Add independent, unchecked customer choices for appointment SMS, appointment email, marketing SMS and marketing email.
- A staff member can record consent only after the customer affirmatively agrees; require source, exact disclosure version, timestamp, staff identity and evidence reference.
- Do not silently opt in imported customers or infer marketing permission from a booking.
- Show current consent, history, and suppression; allow revocation and opt-out without hiding past audit records.
- Enable 'Send confirmation' only for approved/scheduled appointments, with verified contact and policy checks.
- Do not call Twilio or Brevo from browser code.

## API and worker
1. Authenticated owner endpoint validates role, CSRF/origin, customer/appointment ownership and consent evidence.
2. Store lead and consent event separately; only after appointment approval and confirmed schedule, atomically enqueue confirmation.
3. Worker re-reads appointment status/version, recipient suppression and latest purpose-specific consent immediately before each send.
4. Claim pending messages atomically; enforce unique idempotency key and provider retries with backoff.
5. Twilio REST API server-side only; verify webhook signatures against the exact public URL and raw request data. Handle STOP/START/HELP and suppression. Use registered sender and A2P 10DLC where applicable.
6. Brevo transactional email server-side only; process signed/authenticated delivery webhooks.
7. Reminder scheduler enqueues once per appointment version, e.g. 24h before, never for cancelled/completed appointments. Reschedules invalidate stale pending jobs.
8. Store UTC instants and IANA timezone; format display in America/Los_Angeles with DST handling.
9. Never log provider credentials, message bodies, or customer phone numbers in operational logs.

## Launch gates
- Confirm booking/approval path on deployed preview and Google Calendar ownership.
- Select durable DB, apply migration and rollback plan, secure secrets in preview only.
- Complete Twilio account/sender registration and compliant disclosure review.
- Verify SMS and email opt-in/opt-out behavior, retries, concurrent claims, cancellation/reschedule, webhook spoof rejection, timezone boundaries and provider outage handling.
- Use synthetic customers and provider test credentials; no production sending until owner approval.
- Existing booking behavior must remain unchanged until a separate reviewed PR integrates this module.
