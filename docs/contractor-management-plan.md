# Contractor Management Portal Plan

## Current Baseline

- Production baseline preserved with `rollback-pre-contractor-portal-phase-1-2026-09-07`.
- Existing owner and field manager access remains token-based through the operations portal.
- Google Sheets remains the canonical lead and job store.
- Google Calendar remains the customer appointment availability and booking-event integration.
- Customer appointment approval and contractor assignment approval are separate workflows.

## Phase 1: Individual Contractor Accounts And Portal Foundation

Implemented direction:

- Add database-backed contractor accounts.
- Keep owner and field manager authentication intact.
- Add `CONTRACTOR` as a distinct operations role.
- Require an active database-backed account for contractor sessions.
- Re-check contractor account status on authenticated contractor requests so deactivated users lose access.
- Add owner-only account creation and deactivation.
- Add contractor-safe dashboard empty states.
- Allow contractors to submit attributed leads without giving access to the full lead database.

Acceptance criteria:

- Contractor login requires an individual email and password.
- Contractor sees a personalized greeting.
- Owner can create and deactivate contractor accounts.
- Field manager cannot create, list, or deactivate contractor accounts.
- Contractor cannot access owner-only APIs.
- Contractor lead submissions record authenticated server-side attribution.
- No public contractor signup exists.

## Phase 2: Availability Entry And Owner Overview

Implemented direction:

- Add contractor-owned regular availability, on-call windows, and date-specific exceptions.
- Add owner-only designated shift entry.
- Add owner overview and filters for contractor availability.
- Keep availability separate from confirmed assignments.

Data:

- `contractor_availability`
- Distinguish `REGULAR` and `ON_CALL` availability.
- Store date/day, start time, end time, timezone, status, notes, created-by metadata, and withdrawal timestamp.

Acceptance criteria:

- Contractors can manage only their own availability.
- Regular availability and on-call windows are entered and displayed separately.
- Contractors can edit or withdraw their own active availability.
- Owner can add date-specific designated shifts for a contractor.
- Owner can view all contractors' availability.
- Owner can filter availability by contractor and type.
- Availability remains distinct from confirmed job assignments.
- Overlapping active windows are rejected for the same contractor and same date/day.
- America/Los_Angeles is used as the business timezone.
- Deactivated contractor history remains readable to owner.

## Phase 3: Assignment Model And Owner Approval

Data:

- `contractor_assignments`
- Store lead/job ID, contractor ID, scheduled start/end, status, service summary, city, access notes, and calendar sync state.

Acceptance criteria:

- Owner sets required crew size per job.
- System can propose a crew without confirming it.
- Owner can approve, edit, or reject proposed crews.
- Approval rechecks contractor availability and existing assignments.
- Crew approval does not resend customer confirmations or duplicate customer booking Calendar events.
- Duplicate approval attempts do not create duplicate assignments.

## Phase 4: Scheduling Recommendations

Inputs:

- Contractor regular availability.
- Contractor on-call availability.
- Requested job date/time.
- Owner-entered crew size.
- Existing confirmed assignments.
- Configurable fixed travel buffer.
- Optional owner travel-buffer override.

Acceptance criteria:

- Recommendations identify available regular contractors.
- Recommendations identify on-call candidates separately.
- Recommendations flag insufficient staffing.
- Recommendations explain conflicts without exposing private customer data to contractors.
- Owner approval is required before assignments become confirmed.

## Phase 5: Work History And Hours Approval

Data:

- `contractor_time_records`
- Actual start and end times.
- Unpaid break minutes.
- Calculated hours.
- Submission status.
- Owner approval/correction status.
- Audit trail.

Acceptance criteria:

- Contractors can review previous shifts and actual worked hours.
- Contractors submit actual hours for their own assignments.
- Owner can review, correct, approve, or request corrections.
- Weekly and monthly totals separate pending and approved hours.
- Duplicate time records for the same assignment are prevented.
- Calendar edits never overwrite approved worked hours.
- Overnight shifts use the business timezone consistently.
- Deactivated accounts retain history.
- Payroll/payment calculations remain out of scope.

## Phase 6: Calendar Sync And Failure Recovery

Acceptance criteria:

- Customer appointment Calendar integration continues to use the existing WHS Calendar.
- Personal contractor Google Calendar integrations remain out of scope.
- Assignment conflicts are rechecked before owner approval.
- Calendar edits and cancellations are detected or reconciled.
- Sync failures are recorded and recoverable.
- Existing booking event duplicate prevention remains intact.

## Setup Requirements

- Provision a Postgres-compatible database for contractor operations.
- Preview uses an isolated Vercel Marketplace Neon resource connected only to the Preview environment.
- Set `CONTRACTOR_DATABASE_URL` before contractor accounts are usable. Production remains intentionally unconfigured until a production contractor-data release is approved.
- Apply all `db/migrations/*.sql` with `scripts/apply-contractor-migrations.mjs`, or let the app run its matching idempotent schema creation path on first authenticated owner/contractor use.
- No `ACCOUNT_MANAGER` role is planned yet.
