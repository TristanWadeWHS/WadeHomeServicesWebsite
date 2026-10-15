# AI pricer booking — Phase 2 candidate

## Baselines and rollback

Pricer starting branch: codex/customer-inquiry-phase-1, 8a33229a2f0d68713baff0b4cba79ce3c8b3056d (draft PR 23).
Pricer main/Production: 90ae1c249069a9f5ff05018c48271403dfad33b2,
dpl_3Vm9usvhFAEeLj3nNFGA6FTuBy7H, https://whs-pricing-tool-p8kg-5mi2ff1wm-wade-home-services.vercel.app.
Working Phase 1 rollback Preview: https://whs-pricing-tool-p8kg-fpsie0u88-wade-home-services.vercel.app.
Website main/Production: e8dec3ee4444df51c729d34a99d03a4e1b3cfd6e,
dpl_4BEqKEVRJ2P6ptXoQBDNnFEEQAny, https://wade-home-services-push-mnqhms791-wade-home-services.vercel.app.
Both Production deployments were confirmed READY via Vercel. Work is isolated on
codex/ai-pricer-booking-phase-2 in each repository. No merge, domain change,
Production deployment or deletion of prior versions is authorized.

## Behavior

Book the Job opens name, street, city, state, ZIP, optional access/special notes,
date and available time selection. Phone/email, service selections, description,
confirmed scope, photos and quote come from authenticated saved records. Browser
cannot override these. The customer explicitly consents before submitting.
Times use the website's Google Calendar free/busy and existing Pacific rules.
Missing calendar/error responses fail closed. Both start and end must match a
generated available slot, not just a browser-provided label. Owner approval retains
its existing final availability recheck, amount/owner entry, decline and close.

Submission writes Pending Approval, Source=AI Pricer, Appointment Type=AI Price /
Estimate, stable request ID AI-<estimate UUID>, contacts, address, requested time,
description and private photo copies into the website's existing request sheet.
Original provisional quote/revision, submission ID, detailed service selections,
confirmed scope and special notes are retained in JSON on the first line of
Internal Notes. Later owner audit notes append below it; the owner UI reads the
first line so original metadata survives approvals. Approved Amount stays blank
until the owner enters it. No pricing calculations or customer promotions change.

## Durable writes and photos

Pricer records immutable booking-attempt:<UUID> events and a booking-result event,
and sets booking_job_id after a verified response. Retry payloads must match.
Website atomically creates an AI_<estimate UUID> named-range receipt and appends
the row in one Sheets batch, following the existing Command Center pattern.
Concurrent requests/uncertain responses reconcile by stable lead ID. Do not delete
AI receipt named ranges. One estimate produces at most one request, even if the
customer retries with another attempt ID. Scope changes after booking require owner
review; they do not silently replace the submitted snapshot.

Website copies ordered optimized photos into deterministic private
booking-photos/leads/AI-<estimate UUID>/ paths. Original and optimized pricer
objects stay unchanged. No pricer path is passed to the website rename/cleanup
flow. Copies are never deleted on uncertain Sheet outcomes; failed attempts can
leave private orphan copies requiring a future reviewed retention process.
Original-resolution photos remain in authenticated pricer history.

## Server contract and configuration

Both apps: PRICER_BOOKING_ENABLED=true and fresh shared AI_PRICER_BRIDGE_SECRET
(at least 32 characters), server-side and scoped to the feature Preview branch.
Pricer: WHS_BOOKING_ORIGIN = exact website Preview HTTPS origin;
PRICER_HISTORY_ENABLED=true and existing verified private storage configuration.
Website: AI_PRICER_ORIGIN = exact pricer Preview HTTPS origin; reuse configured
Calendar/Sheet and private Blob credentials. These origins must be verified from
actual deployments. No customer data or credentials go in handoff URLs.
Optional WHS_BOOKING_PREVIEW_BYPASS / AI_PRICER_PREVIEW_BYPASS are server-only
Vercel protection bypass credentials if the respective Preview requires them.

POST /api/booking/availability and /api/booking/request require same-origin,
visitor ownership and a current completed signed estimate. Request token is not
logged. The pricer proxies availability and submits a server-built snapshot to
POST /api/integrations/ai-pricer/{availability,submit} on the website.
HMAC authenticates endpoint path, timestamp (60-second window) and exact body.
POST /api/booking/photo-export is the only internal-auth proxy exemption; it
independently authenticates HMAC and restricts photos to that saved attempt.
No endpoint accepts an arbitrary photo URL, Blob path or redirect.

Preview writes do not create Calendar events or send notifications. Owner
approval remains an explicit later action using existing customer confirmations.
Customer success copy says request received, review shortly, pending approval,
and time not confirmed. It does not promise automatic approval.

## Verification and release gates

Targeted tests cover authenticated payloads, expiry/tampering, origin/visitor and
unfinished-estimate rejection, private contact authority, service mappings,
immutable retry snapshots, original quote preservation, ordered photo IDs,
concurrent durable append, lost acknowledgements, slot conflicts and calendar
errors. Existing regression suites and TypeScript must pass before release.
Desktop/mobile browser script now covers form, availability, submission failure,
exact retry and pending receipt with mocked network; no live AI needed.
Browser/runtime verification and native iPhone remain explicit gates unless a
subsequent result below records them as passed. A build alone is insufficient.
Production integration needs approval after Preview review. Phases 3–4 unchanged.
