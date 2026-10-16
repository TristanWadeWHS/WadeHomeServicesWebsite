# Isolated AI booking adapter continuation

Starting adapter: 6f992ffd395dcedc55532c7d17e69b2c49d78a83 (draft PR 3).
Remote annotated snapshot: snapshot-booking-phase2-website-6f992ff.
Paired pricer baseline: 6688ca5a01ba13f8cb4357500dba9216cbcc137a (draft PR 25),
remote snapshot snapshot-booking-phase2-pricer-6688ca5.
Both new branches: codex/booking-handoff-verification. Preserve all earlier refs.

Website main is e8dec3ee4444df51c729d34a99d03a4e1b3cfd6e. Historical/unverified
Production rollback: dpl_4BEqKEVRJ2P6ptXoQBDNnFEEQAny at
https://wade-home-services-push-mnqhms791-wade-home-services.vercel.app.
This is recorded history, not fresh verification of the deployed source.
Recover code by branching from the snapshot, never resetting main or old PRs.
Fresh Production/rollback verification and separate approval are mandatory
before any release. No Production action is part of this work.

The adapter reuses existing Calendar availability, Pending Approval records,
private copies and atomic Sheets receipt+append. This continuation preserves
AI metadata on owner note replacement, records request ID, checks immutable
payload identity on retries (including concurrent winners), and refuses to
label reviewed jobs as pending. A conflicting retry does not create another row.

Submission is restricted to VERCEL_ENV=preview AND
AI_PRICER_SYNTHETIC_TEST_MODE=true. Names must begin TEST (em dash) WHS AI Pricer.
Synthetic metadata is server-set. Browser flags cannot suppress notifications:
the separate adapter never invokes the ordinary booking notification sender.
Ordinary website bookings/notifications are unchanged. The adapter creates no
Calendar event, never renames/deletes pricer photos, and retains uncertain copies.

Tests mock Google access and durable Sheet behavior; this is not proof of live
Sheets atomicity, Calendar configuration, Blob access or mobile operation.
No live test writes were made. Keep booking disabled until the paired Previews
are configured and verified. Current Vercel connection cannot inspect/deploy
this website project. No fresh READY paired Preview is certified.

After access is restored, verification must record each synthetic estimate,
request, lead and private copy identifier; inspect the Pending Approval row and
authenticated owner photo views, never approve or delete test records. Original
quote/linkage must survive mocked owner transitions; Approved Amount stays blank
until an authorized owner action. Existing customer data must remain untouched.
