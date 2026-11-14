# Command Center daily email

The production website reads the dedicated Notes History sheet and sends an 8 AM America/Los_Angeles digest through the existing Brevo integration. No AI is required.

Sections, in order: high/urgent open notes (repeated each day until closed), other overdue follow-ups, other follow-ups due today through seven calendar days ahead (inclusive), and other open notes older than fourteen calendar days. Completed/cancelled notes are excluded. Each note appears once; higher sections retain due-date and age details. Creation date is the available age signal, not proof of customer non-response. Long notes are excerpted with a link to the portal.

## Production configuration

Keep the existing BREVO_API_KEY and dedicated COMMAND_CENTER_SPREADSHEET_ID credentials. Set COMMAND_CENTER_DIGEST_EMAILS to the exact comma-separated approved recipients. Set a dedicated, randomly generated CRON_SECRET of at least 32 characters. Do not use an owner login password and do not commit either variable's value. Redeploy after configuration.

Two once-daily UTC cron entries run at 15:00 and 16:00. The handler sends only during the 08:00 hour in America/Los_Angeles, automatically covering daylight saving changes. Vercel's scheduling precision depends on the plan; Hobby can run within the hour. Preview never sends live digest email.

Vercel must have Cron Jobs enabled for the project. The handler requires the Authorization bearer secret; it does not trust a user-agent string. GET /api/owner/command-center/digest exposes configuration/last receipt to the authenticated owner only. POST to the same endpoint sends today's digest immediately (same-origin owner session required) and consumes today's daily delivery slot. Neither endpoint accepts arbitrary recipient overrides.

## Delivery receipts

The first run creates a separate Daily Digests tab in the dedicated Command Center spreadsheet. An atomic named-range receipt claims each Pacific date before contacting Brevo, so concurrent invocations and lost claim acknowledgements do not send twice. A stable provider idempotency key adds another guard. High-priority reminders are re-selected from current open notes every day; a previous day's receipt does not suppress them.

Sent means Brevo accepted the request, not inbox delivery. Failed means the provider rejected it; Uncertain means the send request timed out or disconnected. Sending can remain if a process ended unexpectedly or the provider accepted but the final receipt write failed. Failed/Uncertain/Sending receipts are not automatically re-sent that day because acceptance may be ambiguous. Inspect Brevo's delivery logs and the receipt before any recovery. No personal note content, recipient addresses, or API keys are logged by these handlers.

## Verification

Run npm test and npm run build. Tests use synthetic notes and mocked Google/Brevo endpoints; they do not send real email. After production configuration, verify cron settings and send one owner-authenticated current digest. Confirm acceptance in Daily Digests and receipt in all approved mailboxes. The code deployment alone does not confirm scheduler activation or successful email delivery.
