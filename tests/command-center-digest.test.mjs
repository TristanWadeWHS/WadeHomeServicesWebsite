import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { HEADERS, fromRow, toRow } from "../app/lib/command-center/model.ts";
import { selectDigest, digestDueNow, digestRecipients, buildDigestPayload } from "../app/lib/command-center/digest.ts";
import { sendDailyDigest, sendTestDigest } from "../app/lib/command-center/send-digest.ts";
import { claimDailyDigest } from "../app/lib/command-center/digest-store.ts";
import { GET as cron } from "../app/api/cron/command-center-digest/route.ts";
import { GET as status, POST as manual } from "../app/api/owner/command-center/digest/route.ts";
import { createOperationsSession, ROLE_FIELD_MANAGER, ROLE_OWNER, OPERATIONS_SESSION_COOKIE, OPERATIONS_SESSION_ACTIVE_COOKIE } from "../app/lib/booking/ownerAuth.ts";

const now = new Date("2026-11-14T16:00:00Z");
function note(id, extra = {}) { return { ...fromRow([id, "2026-11-13T10:00:00-08:00", "Fixture Client", "", `Note ${id}`, "", "General", "Normal", "No", "", "Noted", ""]), ...extra }; }
test("daily digest includes all priority and date/age boundaries, excludes closures, and avoids repeats", () => {
  const sections = selectDigest([
    note("high", { priority: "High", followUp: "Yes", followUpDate: "2026-11-13", timestamp: "2026-10-01T10:00:00-07:00" }),
    note("urgent", { priority: "Urgent" }),
    note("overdue", { followUp: "Yes", followUpDate: "2026-11-13" }),
    note("today", { followUp: "Yes", followUpDate: "2026-11-14" }),
    note("seven", { followUp: "Yes", followUpDate: "2026-11-21" }),
    note("eight", { followUp: "Yes", followUpDate: "2026-11-22" }),
    note("stale", { timestamp: "2026-10-30T10:00:00-07:00" }),
    note("exact14", { timestamp: "2026-10-31T10:00:00-07:00" }),
    note("badtime", { timestamp: "invalid" }),
    note("done", { priority: "High", status: "Completed" }),
    note("cancel", { priority: "Urgent", status: "Cancelled" }),
    note("closedAt", { priority: "High", completedAt: "2026-11-13T10:00:00-08:00" }),
  ], now);
  assert.deepEqual(sections.map(s => s.notes.map(n => n.id)), [["urgent", "high"], ["overdue"], ["today", "seven"], ["stale"]]);
  assert.equal(selectDigest([note("high", { priority: "High" })], new Date("2026-11-15T16:00:00Z"))[0].notes.length, 1, "High notes repeat tomorrow until closed");
});
test("8 AM delivery uses Pacific standard/daylight time and both transition dates", () => {
  for (const date of ["2026-11-14T16:00:00Z", "2026-07-14T15:00:00Z", "2026-03-08T15:30:00Z", "2026-11-01T16:30:00Z"]) assert.equal(digestDueNow(new Date(date)), true);
  for (const date of ["2026-11-14T15:00:00Z", "2026-07-14T16:00:00Z"]) assert.equal(digestDueNow(new Date(date)), false);
});
test("email rendering escapes note content, labels aging accurately, and validates the full recipient set", () => {
  const recipients = digestRecipients("ONE@example.test, two@example.test;one@example.test");
  assert.deepEqual(recipients, ["one@example.test", "two@example.test"]);
  for (const value of ["", "one@example.test,not-an-email", "a@b.test\r\nBcc: thief@example.test"]) assert.throws(() => digestRecipients(value));
  const p = buildDigestPayload([note("malicious", { clientName: '<img src="bad">', original: "<script>alert(1)</script>", priority: "High", followUp: "Yes", followUpDate: "2026-11-01", timestamp: "2026-10-01T10:00:00-07:00" })], recipients, now);
  assert.ok(!p.htmlContent.includes("<script>")); assert.ok(p.htmlContent.includes("&lt;script&gt;")); assert.ok(p.htmlContent.includes("OVERDUE")); assert.match(p.textContent, /Open 44 days/);
  assert.equal(p.sender.email, "hello@wadehomeservices.com"); assert.equal(p.replyTo.email, "wadehomeservices@yahoo.com");
  assert.equal(p.to.length, 2); assert.ok(p.textContent.includes("does not confirm a client has failed to respond"));
  assert.equal(p.headers.IdempotencyKey, buildDigestPayload([], recipients, now).headers.IdempotencyKey);
  assert.match(buildDigestPayload([], recipients, now).textContent, /No high priorities/);
});

async function fixture(run) {
  const oldFetch = globalThis.fetch, oldEnv = { ...process.env };
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "fixture@example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }), COMMAND_CENTER_SPREADSHEET_ID: "digest-fixture", OWNER_APPROVAL_TOKEN: "owner-fixture", FIELD_MANAGER_ACCESS_TOKEN: "manager-fixture", BREVO_API_KEY: "email-fixture", COMMAND_CENTER_DIGEST_EMAILS: "owner@example.test,second@example.test,third@example.test", VERCEL_ENV: "production", CRON_SECRET: "cron-fixture" });
  const tables = { 7: [[...HEADERS], toRow(note("fixture-high", { priority: "High" }))], 8: [] };
  const receipts = new Set();
  const state = { providerCalls: 0, providerMode: "success", payload: null, loseClaimAck: false, ledgerExists: false, tables };
  globalThis.fetch = async (input, options = {}) => {
    const url = decodeURIComponent(String(input));
    const body = options.body && String(options.body).startsWith("{") ? JSON.parse(options.body) : {};
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    if (url.includes("api.brevo.com")) {
      state.providerCalls++; state.payload = body;
      assert.equal(options.headers["api-key"], "email-fixture");
      if (state.providerMode === "timeout") throw new Error("Timeout");
      return state.providerMode === "failure" ? new Response("Provider error with sensitive data", { status: 429 }) : Response.json({ messageId: "fixture-message" }, { status: 201 });
    }
    assert.ok(url.includes("/digest-fixture"), "No writes outside the dedicated Command Center sheet");
    if (url.includes("?fields=")) return Response.json({ sheets: [{ properties: { sheetId: 7, title: "Notes History", gridProperties: { columnCount: 14 } } }, ...(state.ledgerExists ? [{ properties: { sheetId: 8, title: "Daily Digests" } }] : [])] });
    if (url.endsWith("/values:batchUpdate")) {
      for (const entry of body.data) {
        const table = tables[entry.range.includes("Daily Digests") ? 8 : 7];
        const match = /!([A-Z])(\d+)/.exec(entry.range), row = Number(match[2]) - 1, column = match[1].charCodeAt(0) - 65;
        entry.values[0].forEach((value, i) => { table[row][column + i] = value; });
      }
      return Response.json({});
    }
    if (url.endsWith(":batchUpdate")) {
      if (body.requests[0].addSheet) { assert.equal(body.requests[0].addSheet.properties.title, "Daily Digests"); state.ledgerExists = true; return Response.json({}); }
      const ids = body.requests.flatMap(r => r.addNamedRange ? [r.addNamedRange.namedRange.namedRangeId] : []);
      if (ids.some(id => receipts.has(id))) return new Response("Duplicate receipt", { status: 400 });
      ids.forEach(id => receipts.add(id));
      for (const op of body.requests) {
        if (op.updateCells) {
          const u = op.updateCells, start = u.start || { sheetId: u.range.sheetId, rowIndex: u.range.startRowIndex, columnIndex: u.range.startColumnIndex };
          const table = tables[start.sheetId]; table[start.rowIndex] ||= [];
          u.rows[0].values.forEach((cell, i) => { table[start.rowIndex][start.columnIndex + i] = cell.userEnteredValue.stringValue; });
        }
        if (op.appendCells) tables[op.appendCells.sheetId].push(op.appendCells.rows[0].values.map(cell => cell.userEnteredValue.stringValue));
      }
      if (state.loseClaimAck && ids.some(id => /^cc_digest_\d/.test(id))) { state.loseClaimAck = false; throw new Error("Lost acknowledgement after commit"); }
      return Response.json({});
    }
    return Response.json({ values: structuredClone(tables[url.includes("Daily Digests") ? 8 : 7]) });
  };
  try { await run(state); }
  finally { globalThis.fetch = oldFetch; for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]; Object.assign(process.env, oldEnv); }
}
function req(method = "GET", role) {
  const headers = { origin: "https://fixture.test" };
  if (role) headers.cookie = `${OPERATIONS_SESSION_COOKIE}=${createOperationsSession({ role, label: "Fixture" })}; ${OPERATIONS_SESSION_ACTIVE_COOKIE}=1`;
  return new Request("https://fixture.test/api/owner/command-center/digest", { method, headers });
}
test("digest sends once to the approved three recipients, records acceptance, and repeats high items next day", () => fixture(async state => {
  state.loseClaimAck = true;
  const sends = await Promise.all([sendDailyDigest(now), sendDailyDigest(now), sendDailyDigest(now)].map(p => p.catch(error => ({ error }))));
  assert.equal(sends.filter(r => r.sent).length, 1); assert.equal(state.providerCalls, 1);
  assert.deepEqual(state.payload.to.map(r => r.email), ["owner@example.test", "second@example.test", "third@example.test"]);
  assert.equal(state.tables[8][1][2], "Sent"); assert.equal(state.tables[8][1][5], "fixture-message");
  assert.equal((await sendDailyDigest(now)).skipped, true); assert.equal(state.providerCalls, 1);
  await sendDailyDigest(new Date("2026-11-15T16:00:00Z")); assert.equal(state.providerCalls, 2); assert.ok(state.payload.textContent.includes("fixture-high"));
}));
test("receipt claims are atomic; rejected/uncertain sends do not silently retry", () => fixture(async state => {
  const claims = await Promise.all([claimDailyDigest("2026-11-12", 3), claimDailyDigest("2026-11-12", 3)]);
  assert.equal(claims.filter(c => c.claimed).length, 1);
  state.providerMode = "failure";
  await assert.rejects(sendDailyDigest(now), /did not accept/);
  assert.equal(state.tables[8].find(row => row[1] === "2026-11-14")[2], "Failed");
  await assert.rejects(sendDailyDigest(now), /failed/); assert.equal(state.providerCalls, 1);
  state.providerMode = "timeout";
  const tomorrow = new Date("2026-11-15T16:00:00Z");
  await assert.rejects(sendDailyDigest(tomorrow), /could not be confirmed/);
  assert.equal(state.tables[8].find(row => row[1] === "2026-11-15")[2], "Uncertain");
  await assert.rejects(sendDailyDigest(tomorrow), /uncertain/); assert.equal(state.providerCalls, 2);
}));
test("configuration, production, cron credentials and owner/origin guards fail closed", () => fixture(async state => {
  assert.equal((await cron(req())).status, 401);
  assert.equal((await status(req())).status, 401);
  assert.equal((await manual(req("POST", ROLE_FIELD_MANAGER))).status, 403);
  const cross = req("POST", ROLE_OWNER); cross.headers.set("origin", "https://other.test");
  assert.equal((await manual(cross)).status, 403);
  process.env.VERCEL_ENV = "preview"; await assert.rejects(sendDailyDigest(now), /only in production/);
  process.env.VERCEL_ENV = "production"; process.env.COMMAND_CENTER_DIGEST_EMAILS = "";
  await assert.rejects(sendDailyDigest(now), /approved recipient/);
  assert.equal(state.providerCalls, 0); assert.equal(state.tables[8].length, 0);
}));

test("explicit test emails use the authenticated sender without altering the daily receipt", () => fixture(async state => {
  await sendDailyDigest(now);
  const savedReceipts = structuredClone(state.tables[8]);
  const requestId = randomUUID();
  const testResult = await sendTestDigest(requestId, now);
  assert.equal(testResult.sent, true); assert.equal(state.providerCalls, 2);
  assert.match(state.payload.subject, /^\[TEST\]/);
  assert.equal(state.payload.sender.email, "hello@wadehomeservices.com");
  assert.equal(state.payload.replyTo.email, "wadehomeservices@yahoo.com");
  assert.equal(state.payload.to.length, 3); assert.equal(state.payload.headers.IdempotencyKey, requestId);
  assert.deepEqual(state.tables[8], savedReceipts);
  await sendTestDigest(requestId, now); assert.equal(state.payload.headers.IdempotencyKey, requestId, "Retries keep the provider duplicate-protection key");
  await assert.rejects(sendTestDigest("invalid", now), /Invalid test email/);
}));
