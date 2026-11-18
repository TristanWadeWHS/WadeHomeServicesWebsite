# Booking experience integration

## Scope and preserved functionality

This branch starts from GitHub `main` at `087f7b75943f04901abe166c58ef36c334d1e856`. It applies only the uncommitted booking improvements from the preserved local `codex/booking-handoff-verification` checkout. No commits from that branch's separate AI-pricer work were merged.

- Step 7 has one optional promo input, normalized to uppercase; form state persists through navigation and Step 8 shows the code.
- Server validation bounds codes to 64 characters and records them in existing booking Internal Notes. Owner emails include the code in HTML and plain text. Blank and unknown codes remain valid for manual review.
- No automatic discount calculation, minimum purchase, maximum savings, or expiration rejection was introduced. No sheet schema migration or environment-variable change is needed.
- Confirmation uses the existing Winston artwork, customer first name, actual returned request number, and pending-confirmation messaging. It scrolls instantly below the sticky header and focuses the heading with an accessible success description. Existing reduced-motion support remains.
- Current-main Command Center features, digest/test-email actions, authenticated sender/reply-to identity, cron schedules, booking storage implementation, package scripts/dependencies, and production-related settings are unchanged. In particular, `ownerNotifications.ts` retains the shared `EMAIL_SENDER` and `EMAIL_REPLY_TO` imports; only two promo display fields were added.

## Happy HAULidays manual campaign

Code: **HAULIDAY15**. Offer: **15% off any service**, valid through **December 31, 2026, Pacific time**. No minimum purchase or maximum discount. Management reviews eligibility and manually applies the discount. No activation setting is required. Promo notes are editable booking notes and should be retained for tracking.

## Validation on latest main

- Complete `npm test` suite: **62/62 passed**, including current Command Center/digest/email-identity coverage and promo regression tests.
- Six synthetic real-handler API scenarios passed: idempotent retries, busy-slot rejection, save failure, notification failure, blank code, and overlength rejection.
- `npx tsc --noEmit --incremental false`: passed.
- Default `npm run build` (Turbopack): passed in this clean worktree without production environment files.
- Targeted ESLint for all changed TypeScript and browser/unit test files: passed.
- Four full eight-step browser scenarios passed with real route handlers and synthetic services, including Back/Continue promo persistence and desktop photo upload. All four captured owner notifications retained hello@wadehomeservices.com as sender and wadehomeservices@yahoo.com as reply-to.
- Eight production-build browser cases passed: both HAULIDAY15 and blank submission at 1366×900, 768×900, 390×844, and 320×667. Winston and the heading fit below the sticky header; one instant scroll occurs; focus lands on the heading; Tab advances to Return Home; reduced motion is respected; no later image/animation scroll occurred.

The checked-in browser test is `tests/booking-confirmation.browser.mjs`. Serve a local production build, set `BOOKING_QA_URL` to its loopback URL, and set `PLAYWRIGHT_MODULE` to an existing Playwright installation if needed. Run `node tests/booking-confirmation.browser.mjs`. The harness refuses non-loopback hosts and uses synthetic APIs. No new application dependency was introduced.

Additional full-flow tests use the real availability/submission handlers with local Google/Blob/Brevo test doubles. Evidence is retained locally under Git-ignored `work/integration-qa` and `work/booking-confirmation-qa`. These tests do not prove live service persistence or inbox delivery.

## Separate pre-existing issues

- Full repository lint reports **one** `react/no-unescaped-entities` error at `app/owner/command-center/CommandCenter.tsx:161`. This file is unchanged from the base commit. It blocks a clean lint gate but not the default production build or tested booking flow. No unrelated fix is included.
- The existing CSP blocks `www.googletagmanager.com/gtag/js`. The booking browser tests introduce no new CSP failures. Attribution remains affected; the CSP was not changed.
- Prior lint results from the older working branch are not the results for this integration branch.

## Remaining manual QA and deployment boundary

Before production approval, use designated staging resources to verify Google Sheets read-back for blank/promo bookings, real Calendar availability/conflict handling, private Blob upload/lead association/authenticated retrieval, and Brevo delivery to explicitly approved test recipients. Verify customer confirmation remains tied to owner approval. Physical mobile keyboards, Safari/Firefox, and actual screen-reader announcements also require manual QA.

No production environment variables, Vercel settings, domain assignments, cron settings, or production deployment are changed by this PR. Preview availability depends on the repository's Vercel integration and project access. Do not merge or promote without review.
