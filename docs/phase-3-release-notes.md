# Phase 3 Release Notes

## Customer Booking

- `/book` guides customers through service selection, appointment type, contact details, service address, project description, optional photos, and requested time.
- Calendar availability is read server-side from the configured Google Calendar and exposed only as available customer-facing slots.
- Customer submissions are saved to Google Lead Data -> Open Leads with `Status = Pending Approval` and `Source = Website`.
- Website leads use the canonical Sheet columns while preserving legacy dashboard columns in place.

## Owner Approval

- `/owner/approvals` uses a secure owner login flow backed by `OWNER_APPROVAL_TOKEN`.
- The raw owner token is submitted by POST only and is not rendered into owner HTML, links, hidden fields, or client-side JavaScript.
- Successful login creates a signed `HttpOnly`, `Secure`, `SameSite=Strict` owner session cookie.
- Approve re-checks Google Calendar free/busy before confirmation.
- Approved leads create one busy/opaque Calendar event and update the Sheet with Approved status, decision timestamp, Calendar Event ID, confirmed date, and confirmed time.
- Duplicate approval is idempotent and reuses the stored Calendar Event ID.
- Decline updates the Sheet with Declined status, decision timestamp, and decline reason without creating a Calendar event.
- Conflict protection leaves the lead unresolved as `Pending Approval - Time Conflict` when the requested time becomes busy before approval.

## Deferred

- Customer photo uploads remain optional and do not block production readiness.
- Email notifications are not configured yet and remain Phase 4 work.

## Rollback

1. Do not delete the rollback tags.
2. To inspect the last verified Phase 1/2 state, use `git show phase-1-2-verified`.
3. To restore the codebase locally to Phase 1/2 for emergency recovery, create a new branch from the tag:
   `git switch -c rollback/phase-1-2 phase-1-2-verified`
4. To inspect this Phase 3 release candidate, use `git show phase-3-verified-pre-prod`.
5. Production rollback should be performed by deploying or promoting the desired verified commit/tag through the normal Vercel production process after owner approval.
