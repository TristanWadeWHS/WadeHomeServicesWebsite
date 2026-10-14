# Command Center Phase 1

Baseline: production `d431b3f60f715c29b948f702f416a89893c6c256`.
Verified production/rollback deployment: `dpl_8D7oYKifN4zUBYEtuBTWrZeqzJPv`,
https://wade-home-services-push-o598te3ap-wade-home-services.vercel.app.

Work is isolated on `codex/command-center-phase-1`. The owner selected production
as the baseline and explicitly deferred the AI Pricer tab. The unmerged
`codex/owner-ai-pricer-integration` branch and all pricing work remain untouched.
No merge to main or production deployment is authorized by this feature.

## Behavior and boundaries

Owner navigation: Requests, Active Jobs, Leads, Command Center. Direct page:
`/owner/command-center`. Page and all GET/POST actions enforce existing Owner
sessions. Field Managers cannot list, create, interpret, or complete notes.
The only shared Google implementation change exports the existing token helper;
its implementation, credential sources and scope cache are unchanged.

The original note is saved before a separate interpretation request. The browser
retains the same UUID for retrying the same uncertain save. Sheets atomically
adds a unique named-range receipt and the original row in one batch; duplicate
receipts reject the whole append, followed by reconciliation against Note ID.
An ID reused with different text is rejected. Literal string cells preserve
whitespace, line breaks, and formula-like note text without executing it.

Empty Notes History storage is initialized only inside the explicitly configured
spreadsheet with title WHS Command Center Database. Nonempty mismatched headers
fail closed. Existing operational/historical spreadsheet IDs are rejected as
Command Center storage. Do not remove the CC named ranges: they are durable
idempotency receipts, not user data columns.

Columns, in order:
Note ID, Timestamp, Client Name, Client ID, Original Note, AI Summary, Note Type,
Priority, Follow-Up Required, Follow-Up Date, Status, Completed At.

All timestamps include Pacific UTC offsets. AI resolves relative dates from the
original note's Pacific date, including later retries. Client IDs come only from
exact, unambiguous full-name matches to explicit Client ID columns in the existing
historical Raw Data registry. Missing schema, inaccessible data, ambiguous names,
and lead/job identifiers yield a blank Client ID. AI never generates Client IDs.

AI status is Pending or Noted; only the owner marks Completed. Status formulas
respect Completed At so a late AI response cannot undo completion. Interpretation
updates only interpretation cells; completion updates only Status and Completed At.
History is retained, with a completed-history disclosure beneath the three lists.
Today and undated actionable follow-ups appear under Upcoming, rather than
disappearing between the overdue and future lists. Unprocessed notes remain visible
in General Notes as awaiting AI processing. No email, metrics, reporting, or agents
were added.

## Configuration

Required new Preview variable: COMMAND_CENTER_SPREADSHEET_ID.
Owner-supplied ID: `13WFi5wv-OJwPbL-ibBdw6FVoF5nnD1C7Z9pANHzSGC8`.
Use the existing GOOGLE_SERVICE_ACCOUNT_JSON or existing split Google credentials.
That existing account must have edit access to the dedicated spreadsheet.

AI defaults to Vercel project OIDC with AI Gateway (`openai/gpt-4.1-mini`). No new
service account or stored Gateway key is created. Optional OPENAI_API_KEY switches
to direct OpenAI (`gpt-4.1-mini`). Optional COMMAND_CENTER_AI_MODEL overrides the
model; use provider/model for Gateway and the plain model name for direct OpenAI.
Failed/unconfigured AI leaves originals saved and available for Retry AI processing.

On initial verification, Gateway returned customer_verification_required: the team
must add a valid payment card to enable requests, or configure the optional direct
OpenAI key. No billing settings were changed.

## Verification

Focused tests cover RBAC, cross-origin mutations, simultaneous duplicate saves,
retry conflicts, literal original preservation, AI failure, validated interpretation,
relative-date prompt anchoring, Pacific DST boundaries, ambiguous client IDs,
follow-up buckets and completion surviving AI retries. Existing booking/operations
regression tests and TypeScript pass. Run `npm test`, `npx tsc --noEmit`,
and `npm run build` from this checkout.

The owner will manually verify the Preview UI and real Sheet persistence. Live
Sheet writes have not been simulated with customer data. AI provider access is
blocked by the account prerequisite above; mocked interpretation tests pass.

API references:
- https://developers.google.com/workspace/sheets/api/guides/batch
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc
