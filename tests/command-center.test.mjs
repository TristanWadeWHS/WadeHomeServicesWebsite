import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { HEADERS, localDate, localTimestamp, fromRow, groupNotes, resolveClientId } from "../app/lib/command-center/model.ts";
import { saveOriginal, completeNote, saveInterpretation, readNotes } from "../app/lib/command-center/store.ts";
import { interpretNote, validateInterpretation } from "../app/lib/command-center/interpret.ts";
import { GET, POST } from "../app/api/owner/command-center/route.ts";
import { createOperationsSession, ROLE_OWNER, ROLE_FIELD_MANAGER, OPERATIONS_SESSION_COOKIE, OPERATIONS_SESSION_ACTIVE_COOKIE } from "../app/lib/booking/ownerAuth.ts";

test("Pacific dates include DST and use local midnight boundaries", () => {
  assert.equal(localDate(new Date("2026-10-14T02:00:00Z")), "2026-10-13");
  assert.equal(localTimestamp(new Date("2026-10-14T02:00:00Z")), "2026-10-13T19:00:00-07:00");
  assert.equal(localTimestamp(new Date("2026-12-14T02:00:00Z")), "2026-12-13T18:00:00-08:00");
});
test("pending followups include today and undated actions; completion stays in history", () => {
  const note = (id, date, followUp = "Yes", status = "Pending") => fromRow([id, "", "", "", "", "", "", "", followUp, date, status, ""]);
  const groups = groupNotes([note("past", "2026-10-12"), note("today", "2026-10-13"), note("future", "2026-10-14"), note("undated", ""), note("general", "", "No"), note("done", "2026-10-01", "Yes", "Completed")], "2026-10-13");
  assert.deepEqual(groups.overdue.map(n => n.id), ["past"]);
  assert.deepEqual(groups.upcoming.map(n => n.id), ["today", "future", "undated"]);
  assert.equal(groups.general[0].id, "general"); assert.equal(groups.completed[0].id, "done");
});
test("client IDs fail closed on ambiguity, partial names, absent IDs and lead IDs", () => {
  const headers = ["Client Name", "Client ID"];
  assert.equal(resolveClientId("Test Person", "Call Test Person", [headers, ["Test Person", "client-1"]]), "client-1");
  assert.equal(resolveClientId("Test Person", "Call Test Person", [headers, ["Test Person", "client-1"], ["Test Person", "client-2"]]), "");
  assert.equal(resolveClientId("Test", "Call Test", [headers, ["Test", "client-1"]]), "");
  assert.equal(resolveClientId("Test Person", "Call Test Person", [["Name", "Unique ID"], ["Test Person", "lead-1"]]), "");
  assert.equal(resolveClientId("Test Person", "Call another person", [headers, ["Test Person", "client-1"]]), "");
});
test("invalid AI dates and enum values are rejected", () => {
  const value = { clientName: "", summary: "Call back", type: "Follow-up", priority: "Normal", followUp: true, followUpDate: "2026-02-30" };
  assert.throws(() => validateInterpretation(value));
  assert.throws(() => validateInterpretation({ ...value, followUpDate: "", priority: "invented" }));
});

test("API/storage: durable save, atomic retries, AI failure, completion, RBAC and untouched originals", async () => {
  const oldFetch = globalThis.fetch; const oldEnv = { ...process.env };
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "fixture@example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  process.env.COMMAND_CENTER_SPREADSHEET_ID = "command-center-fixture";
  process.env.OWNER_APPROVAL_TOKEN = "fixture-owner-token";
  process.env.FIELD_MANAGER_ACCESS_TOKEN = "fixture-manager-token";
  process.env.OPENAI_API_KEY = "fixture-ai-key";
  let rows = [[...HEADERS]]; const receipts = new Set(); let aiFails = true; let aiPrompt; let loseAcknowledgement = false; let missingSheet = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input); const body = options.body ? JSON.parse(String(options.body).startsWith("{") ? options.body : "{}") : {};
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    if (url.includes("api.openai.com")) {
      aiPrompt = body;
      return aiFails ? new Response("unavailable", { status: 503 }) : Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ clientName: "", summary: "Call tomorrow", type: "Follow-up", priority: "Normal", followUp: true, followUpDate: "2026-10-14", status: "Pending" }) }] }] });
    }
    assert.ok(url.includes("/command-center-fixture"), "Never write operational sheets");
    if (url.includes("?fields=")) return Response.json({ properties: { title: "Owner renamed this spreadsheet" }, sheets: missingSheet ? [] : [{ properties: { sheetId: 7, title: "Notes History" } }] });
    if (url.endsWith("/values:batchUpdate")) {
      for (const entry of body.data) { const m = /!([A-L])(\d+):/.exec(entry.range); const column = m[1].charCodeAt(0) - 65; entry.values[0].forEach((v, i) => { rows[Number(m[2]) - 1][column + i] = v; }); }
      return Response.json({});
    }
    if (url.endsWith(":batchUpdate")) {
      if (body.requests[0].addSheet) { assert.equal(body.requests[0].addSheet.properties.title, "Notes History"); missingSheet = false; return Response.json({}); }
      if (body.requests[0].updateCells) {
        for (const { updateCells: update } of body.requests) update.rows[0].values.forEach((cell, i) => {
          const row = rows[update.range.startRowIndex];
          row[update.range.startColumnIndex + i] = cell.userEnteredValue.stringValue ?? (row[11] ? "Completed" : cell.userEnteredValue.formulaValue.includes('"Noted"') ? "Noted" : "Pending");
        });
        return Response.json({});
      }
      const receipt = body.requests[0].addNamedRange.namedRange.namedRangeId;
      if (receipts.has(receipt)) return new Response("Duplicate receipt", { status: 400 });
      receipts.add(receipt);
      if (receipt === "cc_schema_v1") { rows = [body.requests[1].updateCells.rows[0].values.map(v => v.userEnteredValue.stringValue)]; return Response.json({}); }
      rows.push(body.requests[1].appendCells.rows[0].values.map(v => v.userEnteredValue.stringValue));
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("Connection lost after commit"); }
      return Response.json({});
    }
    return Response.json({ values: structuredClone(rows) });
  };
  function req(body, role) {
    const headers = { origin: "https://fixture.test", "content-type": "application/json" };
    if (role) headers.cookie = `${OPERATIONS_SESSION_COOKIE}=${createOperationsSession({ role, label: "Fixture" })}; ${OPERATIONS_SESSION_ACTIVE_COOKIE}=1`;
    return new Request("https://fixture.test/api/owner/command-center", { method: body ? "POST" : "GET", headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    assert.equal((await GET(req())).status, 401);
    assert.equal((await GET(req(undefined, ROLE_FIELD_MANAGER))).status, 403);
    const id = randomUUID(); const original = "  =literal text\nCall tomorrow.  ";
    for (const action of ["save", "complete", "interpret"]) assert.equal((await POST(req({ action, id, original }, ROLE_FIELD_MANAGER))).status, 403);
    const crossOrigin = req({ action: "save", id, original }, ROLE_OWNER); crossOrigin.headers.set("origin", "https://other.test");
    assert.equal((await POST(crossOrigin)).status, 403);
    const savedResponse = await POST(req({ action: "save", id, original }, ROLE_OWNER));
    assert.equal(savedResponse.status, 200);
    const savedPayload = await savedResponse.json();
    assert.equal(savedPayload.message, "Saved."); assert.equal(savedPayload.note.original, original); assert.equal(savedPayload.note.id, id);
    assert.match(savedPayload.note.timestamp, /T\d{2}:\d{2}:\d{2}-0[78]:00$/);
    assert.equal(aiPrompt, undefined, "Saving returns the persisted note without making an AI request");
    await Promise.all([saveOriginal(id, original), saveOriginal(id, original)]);
    assert.equal(rows.length, 2); assert.equal(rows[1][4], original);
    const concurrentId = randomUUID(); await Promise.all([saveOriginal(concurrentId, "second"), saveOriginal(concurrentId, "second")]);
    assert.equal(rows.length, 3, "Concurrent first saves append exactly once");
    loseAcknowledgement = true;
    const lostId = randomUUID(); await saveOriginal(lostId, "lost acknowledgement"); await saveOriginal(lostId, "lost acknowledgement");
    assert.equal(rows.length, 4, "Lost acknowledgement reconciles without duplicate");
    await assert.rejects(saveOriginal(id, "different"), /different note/);
    assert.equal(await interpretNote((await readNotes())[0]), false);
    assert.equal(rows[1][4], original, "AI failure cannot lose original");
    const completed = await completeNote(id); const completedAgain = await completeNote(id);
    assert.equal(completed.completedAt, completedAgain.completedAt);
    aiFails = false; assert.equal(await interpretNote({ ...(await readNotes())[0], timestamp: "2026-10-13T23:30:00-07:00" }), true);
    assert.match(aiPrompt.instructions, /2026-10-13/); assert.equal(aiPrompt.input, original);
    assert.equal(rows[1][4], original); assert.equal(rows[1][10], "Completed"); assert.equal(rows[1][11], completed.completedAt);
    assert.equal(rows[1][9], "2026-10-14");
    rows[0][0] = "Wrong header"; await assert.rejects(readNotes(), /headers/);
    rows = []; missingSheet = true; assert.deepEqual(await readNotes(), []); assert.deepEqual(rows[0], [...HEADERS]); assert.equal(missingSheet, false);
  } finally { globalThis.fetch = oldFetch; for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]; Object.assign(process.env, oldEnv); }
});
