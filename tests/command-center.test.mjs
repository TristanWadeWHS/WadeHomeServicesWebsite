import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { HEADERS, localDate, localTimestamp, fromRow, groupNotes, validateDetails, resolveClientId } from "../app/lib/command-center/model.ts";
import { saveOriginal, completeNote, cancelNote, completeWithFollowUp, saveInterpretation, readNotes } from "../app/lib/command-center/store.ts";
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
  let gridColumns = 12; let rows = [[...HEADERS]]; const receipts = new Set(); let aiFails = true; let aiPrompt; let loseAcknowledgement = false; let missingSheet = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input); const body = options.body ? JSON.parse(String(options.body).startsWith("{") ? options.body : "{}") : {};
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    if (url.includes("api.openai.com")) {
      aiPrompt = body;
      return aiFails ? new Response("unavailable", { status: 503 }) : Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ clientName: "", summary: "Call tomorrow", type: "Follow-up", priority: "Normal", followUp: true, followUpDate: "2026-10-14", status: "Pending" }) }] }] });
    }
    assert.ok(url.includes("/command-center-fixture"), "Never write operational sheets");
    if (url.includes("?fields=")) return Response.json({ properties: { title: "Owner renamed this spreadsheet" }, sheets: missingSheet ? [] : [{ properties: { sheetId: 7, title: "Notes History", gridProperties: { columnCount: gridColumns } } }] });
    if (url.endsWith("/values:batchUpdate")) {
      for (const entry of body.data) { const m = /!([A-N])(\d+)/.exec(entry.range); const column = m[1].charCodeAt(0) - 65; entry.values[0].forEach((v, i) => { rows[Number(m[2]) - 1][column + i] = v; }); }
      return Response.json({});
    }
    if (url.endsWith(":batchUpdate")) {
      if (body.requests[0].updateSheetProperties) { gridColumns = body.requests[0].updateSheetProperties.properties.gridProperties.columnCount; return Response.json({}); }
      if (body.requests[0].addSheet) { assert.equal(body.requests[0].addSheet.properties.title, "Notes History"); missingSheet = false; return Response.json({}); }
      const incomingReceipts = body.requests.flatMap(r => r.addNamedRange ? [r.addNamedRange.namedRange.namedRangeId] : []);
      if (incomingReceipts.some(receipt => receipts.has(receipt))) return new Response("Duplicate receipt", { status: 400 });
      for (const receipt of incomingReceipts) receipts.add(receipt);
      for (const operation of body.requests) {
        if (operation.updateCells) {
          const update = operation.updateCells;
          const index = update.range?.startRowIndex ?? update.start.rowIndex;
          const column = update.range?.startColumnIndex ?? update.start.columnIndex;
          const row = rows[index] ?? (rows[index] = []);
          update.rows[0].values.forEach((cell, i) => {
            row[column + i] = cell.userEnteredValue.stringValue ?? (row[12] ? "Cancelled" : row[11] ? "Completed" : cell.userEnteredValue.formulaValue.includes('"Noted"') ? "Noted" : "Pending");
          });
        }
        if (operation.appendCells) rows.push(operation.appendCells.rows[0].values.map(v => v.userEnteredValue.stringValue));
      }
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
    assert.equal(savedResponse.status, 200); assert.equal(gridColumns, 14, "Existing sheets expand for cancellation reasons");
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
    const details = { clientName: "Nina", type: "Payment", priority: "High", followUpDate: "2026-11-15" };
    const structuredId = randomUUID();
    const structured = await POST(req({ action: "save", id: structuredId, original: "Call about invoice", details }, ROLE_OWNER));
    assert.equal(structured.status, 200);
    const structuredNote = (await structured.json()).note;
    for (const key of Object.keys(details)) assert.equal(structuredNote[key], details[key]);
    assert.equal(structuredNote.followUp, "Yes"); assert.equal(structuredNote.status, "Pending");
    const count = rows.length;
    await saveOriginal(structuredId, "Call about invoice", details);
    assert.equal(rows.length, count);
    await assert.rejects(saveOriginal(structuredId, "Call about invoice", { ...details, priority: "Low" }), /different note/);
    const before = structuredClone(rows);
    await POST(req({ action: "interpret", id: structuredId }, ROLE_OWNER));
    assert.deepEqual(rows, before, "AI cannot overwrite manually selected fields");
    const invalid = await POST(req({ action: "save", id: randomUUID(), original: "Invalid date", details: { ...details, followUpDate: "2026-02-30" } }, ROLE_OWNER));
    assert.equal(invalid.status, 400); assert.equal(rows.length, count);
    const general = await saveOriginal(randomUUID(), "Idea", { ...details, type: "Idea", followUpDate: "" });
    assert.equal(general.followUp, "No"); assert.equal(general.status, "Noted");
    assert.throws(() => validateDetails({ ...details, priority: "invalid" }));
    assert.throws(() => validateDetails({ ...details, type: "invalid" }));
    const cancelId = randomUUID();
    await saveOriginal(cancelId, "Client no longer needs pickup", details);
    assert.equal((await POST(req({ action: "cancel", id: cancelId, reason: "No longer needed" }, ROLE_FIELD_MANAGER))).status, 403);
    assert.equal((await POST(req({ action: "cancel", id: cancelId, reason: "   " }, ROLE_OWNER))).status, 400);
    assert.equal((await POST(req({ action: "cancel", id: cancelId, reason: "x".repeat(2001) }, ROLE_OWNER))).status, 400);
    const cancelResponse = await POST(req({ action: "cancel", id: cancelId, reason: " Client declined " }, ROLE_OWNER));
    assert.equal(cancelResponse.status, 200);
    const cancelled = (await readNotes()).find(n => n.id === cancelId);
    assert.equal(cancelled.status, "Cancelled"); assert.equal(cancelled.cancellationReason, "Client declined");
    assert.equal(cancelled.original, "Client no longer needs pickup"); assert.ok(cancelled.completedAt);
    const retried = await cancelNote(cancelId, "Another reason");
    assert.equal(retried.cancellationReason, "Client declined"); assert.equal(retried.completedAt, cancelled.completedAt);
    assert.equal((await POST(req({ action: "complete", id: cancelId }, ROLE_OWNER))).status, 409);
    assert.equal((await POST(req({ action: "cancel", id, reason: "Already completed" }, ROLE_OWNER))).status, 409);
    await saveInterpretation(cancelId, { clientName: "", clientId: "", summary: "Late AI", type: "General", priority: "Normal", followUp: "No", followUpDate: "", status: "Noted" });
    const afterAI = (await readNotes()).find(n => n.id === cancelId);
    assert.equal(afterAI.status, "Cancelled"); assert.equal(afterAI.cancellationReason, "Client declined");
    const cancelledGroups = groupNotes(await readNotes());
    assert.ok(cancelledGroups.cancelled.some(n => n.id === cancelId));
    for (const section of ["general", "upcoming", "overdue", "completed"]) assert.ok(!cancelledGroups[section].some(n => n.id === cancelId));
    // Existing 12-column sheets gain only the new header; note contents stay intact.
    rows[0] = HEADERS.slice(0, 12);
    const beforeMigration = structuredClone(rows.slice(1));
    await readNotes();
    assert.deepEqual(rows[0], [...HEADERS]); assert.deepEqual(rows.slice(1), beforeMigration);
    const followParent = randomUUID();
    await saveOriginal(followParent, "Sent quote", details);
    for (const [nextStep, followUpDate] of [["", "2026-11-20"], ["Call client", "2026-02-30"]]) {
      assert.equal((await POST(req({ action: "complete-followup", id: followParent, nextStep, followUpDate }, ROLE_OWNER))).status, 400);
      assert.equal((await readNotes()).find(n => n.id === followParent).status, "Pending");
    }
    const followPayload = { action: "complete-followup", id: followParent, nextStep: "Call to confirm quote", followUpDate: "2026-11-20" };
    assert.equal((await POST(req(followPayload, ROLE_FIELD_MANAGER))).status, 403);
    const crossFollow = req(followPayload, ROLE_OWNER); crossFollow.headers.set("origin", "https://other.test");
    assert.equal((await POST(crossFollow)).status, 403);
    loseAcknowledgement = true;
    const result = await POST(req(followPayload, ROLE_OWNER));
    assert.equal(result.status, 200);
    await Promise.all([completeWithFollowUp(followParent, followPayload.nextStep, followPayload.followUpDate), completeWithFollowUp(followParent, followPayload.nextStep, followPayload.followUpDate)]);
    const all = await readNotes();
    assert.equal(all.find(n => n.id === followParent).status, "Completed");
    const children = all.filter(n => n.parentNoteId === followParent);
    assert.equal(children.length, 1); assert.equal(children[0].clientName, details.clientName); assert.equal(children[0].priority, details.priority);
    assert.equal(children[0].original, followPayload.nextStep); assert.equal(children[0].followUpDate, followPayload.followUpDate);
    assert.equal(children[0].status, "Pending"); assert.equal(children[0].completedAt, "");
    assert.ok(groupNotes(all, "2026-11-19").upcoming.some(n => n.id === children[0].id));
    await assert.rejects(completeWithFollowUp(followParent, "Different action", followPayload.followUpDate), /already been completed/);
    await assert.rejects(completeWithFollowUp(cancelId, "Call", "2026-11-20"), /cancelled/);
    const raceParent = randomUUID(); await saveOriginal(raceParent, "Race check", details);
    const raced = await Promise.allSettled([completeWithFollowUp(raceParent, "Next step", "2026-11-20"), cancelNote(raceParent, "No longer needed")]);
    assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
    const afterRace = await readNotes();
    const raceNote = afterRace.find(n => n.id === raceParent);
    assert.equal(afterRace.filter(n => n.parentNoteId === raceParent).length, raceNote.status === "Completed" ? 1 : 0);
    const retryParent = randomUUID(); await saveOriginal(retryParent, "Concurrent follow-up", details);
    await Promise.all([completeWithFollowUp(retryParent, "Call", "2026-11-20"), completeWithFollowUp(retryParent, "Call", "2026-11-20")]);
    assert.equal((await readNotes()).filter(n => n.parentNoteId === retryParent).length, 1);
    // Upgrade the immediately preceding 13-column schema without touching notes.
    rows[0] = HEADERS.slice(0, 13);
    const priorRows = structuredClone(rows.slice(1));
    await readNotes(); assert.deepEqual(rows[0], [...HEADERS]); assert.deepEqual(rows.slice(1), priorRows);
    rows[0][0] = "Wrong header"; await assert.rejects(readNotes(), /headers/);
    rows = []; missingSheet = true; assert.deepEqual(await readNotes(), []); assert.deepEqual(rows[0], [...HEADERS]); assert.equal(missingSheet, false);
  } finally { globalThis.fetch = oldFetch; for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]; Object.assign(process.env, oldEnv); }
});
