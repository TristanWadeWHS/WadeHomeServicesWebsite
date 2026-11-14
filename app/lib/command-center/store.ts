import { createHash } from "node:crypto";
import { getGoogleAccessToken, HISTORICAL_SPREADSHEET_ID } from "../booking/google";
import { HEADERS, fromRow, toRow, localTimestamp, validDate, type Note, type NoteDetails } from "./model";

const TAB = "Notes History";
export class CommandCenterError extends Error { constructor(message: string, public status = 503) { super(message); } }
export function spreadsheetId() {
  const id = process.env.COMMAND_CENTER_SPREADSHEET_ID?.trim();
  if (!id) throw new CommandCenterError("Command Center storage is not configured. Set COMMAND_CENTER_SPREADSHEET_ID.");
  if ([process.env.GOOGLE_SPREADSHEET_ID, process.env.GOOGLE_SHEETS_SPREADSHEET_ID, HISTORICAL_SPREADSHEET_ID].includes(id)) throw new CommandCenterError("Command Center must use a dedicated spreadsheet.");
  return id;
}
async function request(path: string, body?: object, id = spreadsheetId()) {
  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/spreadsheets"]);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}${path}`, {
    method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new CommandCenterError("Command Center could not access Google Sheets. Check spreadsheet access and retry.");
  return response.json();
}
export async function readNotes() {
  const tabId = await sheetId();
  const data = await request(`/values/${encodeURIComponent(`'${TAB}'!A:N`)}`);
  let rows: string[][] = data.values || [];
  if (rows.length === 0) {
    try {
      await request(":batchUpdate", { requests: [
        { addNamedRange: { namedRange: { namedRangeId: "cc_schema_v1", name: "CC_SCHEMA_V1", range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length } } } },
        { updateCells: { start: { sheetId: tabId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
      ] });
    } catch { /* A concurrent initializer may have won; verify below. */ }
    rows = (await request(`/values/${encodeURIComponent(`'${TAB}'!A:N`)}`)).values || [];
  }
  // Add trailing fields to older sheets without rewriting any note records.
  if (HEADERS.slice(0, 12).some((header, i) => rows[0]?.[i] !== header) || HEADERS.some((header, i) => rows[0]?.[i] && rows[0][i] !== header)) throw new CommandCenterError("Notes History headers do not match the required Command Center schema.");
  const missing = HEADERS.flatMap((header, i) => rows[0]?.[i] ? [] : [{ range: `'${TAB}'!${String.fromCharCode(65 + i)}1`, values: [[header]] }]);
  if (missing.length) await request("/values:batchUpdate", { valueInputOption: "RAW", data: missing });
  return rows.slice(1).map(fromRow).filter(n => n.id);
}
async function sheetId() {
  const data = await request("?fields=properties(title),sheets(properties(sheetId,title,gridProperties(columnCount)))");
  // The owner-configured ID is authoritative. A spreadsheet's display title is
  // mutable and must not prevent initializing its dedicated Notes History tab.
  const sheet = data.sheets?.find((s: { properties: { title: string } }) => s.properties.title === TAB);
  if (!sheet) {
    try { await request(":batchUpdate", { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { columnCount: HEADERS.length, frozenRowCount: 1 } } } }] }); }
    catch { /* A concurrent initializer may have created the same tab. */ }
    const updated = await request("?fields=sheets(properties(sheetId,title))");
    const created = updated.sheets?.find((s: { properties: { title: string } }) => s.properties.title === TAB);
    if (!created) throw new CommandCenterError("Could not initialize Notes History. Check the service account has edit access.");
    return created.properties.sheetId as number;
  }
  if (sheet.properties.gridProperties?.columnCount < HEADERS.length) {
    await request(":batchUpdate", { requests: [{ updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, gridProperties: { columnCount: HEADERS.length } }, fields: "gridProperties.columnCount" } }] });
  }
  return sheet.properties.sheetId as number;
}
export async function saveOriginal(id: string, original: string, details?: NoteDetails) {
  const notes = await readNotes();
  const existing = notes.find(n => n.id === id);
  if (existing) {
    if (existing.original !== original || (details && (existing.clientName !== details.clientName || existing.type !== details.type || existing.priority !== details.priority || existing.followUpDate !== details.followUpDate))) throw new CommandCenterError("This save key belongs to a different note. Reload before saving another note.", 409);
    return existing;
  }
  const tabId = await sheetId();
  const note = details
    ? fromRow([id, localTimestamp(), details.clientName, "", original, "", details.type, details.priority, details.followUpDate ? "Yes" : "No", details.followUpDate, details.followUpDate ? "Pending" : "Noted", ""])
    : fromRow([id, localTimestamp(), "", "", original, "", "Unprocessed", "Normal", "Unknown", "", "Pending", ""]);
  try {
    // Atomic unique receipt + append. A concurrent retry cannot append without
    // creating the same namedRangeId; Sheets rejects that entire duplicate batch.
    await request(":batchUpdate", { requests: [
      { addNamedRange: { namedRange: { namedRangeId: `cc_${id}`, name: `CC_${id.replaceAll("-", "_")}`, range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 } } } },
      { appendCells: { sheetId: tabId, rows: [{ values: toRow(note).map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
    ] });
    return note;
  } catch (error) {
    // Reconcile duplicate responses and lost acknowledgements with persisted data.
    const saved = (await readNotes()).find(n => n.id === id);
    if (saved?.original === original && (!details || (saved.clientName === details.clientName && saved.type === details.type && saved.priority === details.priority && saved.followUpDate === details.followUpDate))) return saved;
    if (saved) throw new CommandCenterError("This save key belongs to a different note.", 409);
    throw error;
  }
}
export async function findNote(id: string) {
  const notes = await readNotes();
  const note = notes.find(n => n.id === id);
  if (!note) throw new CommandCenterError("Note not found.", 404);
  // Locate by ID each time; never accept a row number from the browser.
  const data = await request(`/values/${encodeURIComponent(`'${TAB}'!A:A`)}`);
  const row = (data.values as string[][]).findIndex(r => r[0] === id) + 1;
  if (row < 2) throw new CommandCenterError("Note not found.", 404);
  return { note, row };
}
// A shared unique receipt makes completion, cancellation, and follow-up creation
// mutually exclusive even when two browser tabs close the same note together.
async function closeRecord(note: Note, row: number, status: "Completed" | "Cancelled", reason = "", followUp?: Note) {
  const tabId = await sheetId();
  const completedAt = localTimestamp();
  const receipt = (id: string) => ({ addNamedRange: { namedRange: { namedRangeId: `cc_${id}`, name: `CC_${id.replaceAll("-", "_")}`, range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 } } } });
  try {
    await request(":batchUpdate", { requests: [
      receipt(`closed_${note.id}`),
      { updateCells: { range: { sheetId: tabId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 10, endColumnIndex: 13 }, rows: [{ values: [status, completedAt, reason].map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
      ...(followUp ? [receipt(followUp.id), { appendCells: { sheetId: tabId, rows: [{ values: toRow(followUp).map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } }] : []),
    ] });
    return { ...note, status, completedAt, cancellationReason: reason };
  } catch (error) {
    const notes = await readNotes();
    const saved = notes.find(n => n.id === note.id);
    const child = followUp && notes.find(n => n.id === followUp.id && n.parentNoteId === note.id && n.original === followUp.original && n.followUpDate === followUp.followUpDate);
    if (saved?.status === status && (!followUp || child)) return saved;
    if (saved?.completedAt || saved?.status === "Cancelled" || saved?.status === "Completed") throw new CommandCenterError("This note has already been closed. Refresh to see its latest status.", 409);
    throw error;
  }
}
export async function completeNote(id: string) {
  const { note, row } = await findNote(id);
  if (note.status === "Cancelled") throw new CommandCenterError("This note has already been cancelled.", 409);
  if (note.completedAt || note.status === "Completed") return note;
  return closeRecord(note, row, "Completed");
}
export async function cancelNote(id: string, reason: unknown) {
  if (typeof reason !== "string" || !reason.trim() || reason.length > 2000) throw new CommandCenterError("Enter a cancellation reason of 1–2,000 characters.", 400);
  const { note, row } = await findNote(id);
  if (note.status === "Cancelled") return note;
  if (note.completedAt || note.status === "Completed") throw new CommandCenterError("This note has already been completed.", 409);
  return closeRecord(note, row, "Cancelled", reason.trim());
}
export async function completeWithFollowUp(id: string, original: unknown, date: unknown) {
  if (typeof original !== "string" || !original.trim() || original.length > 40000 || !validDate(date)) throw new CommandCenterError("Enter the next step and a valid follow-up date.", 400);
  const { note, row } = await findNote(id);
  // Stable child IDs make lost acknowledgements and concurrent retries safe.
  const hash = createHash("sha256").update(`command-center-followup:${id}`).digest("hex");
  const childId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  if (note.status === "Cancelled") throw new CommandCenterError("This note has already been cancelled.", 409);
  if (note.completedAt || note.status === "Completed") {
    const child = (await readNotes()).find(n => n.id === childId && n.parentNoteId === id);
    if (child && child.original === original.trim() && child.followUpDate === date) return { note, followUp: child };
    throw new CommandCenterError("This note has already been completed. Refresh to see its latest status.", 409);
  }
  const child: Note = { ...note, id: childId, timestamp: localTimestamp(), original: original.trim(), summary: "", type: "Client follow-up", followUp: "Yes", followUpDate: date, status: "Pending", completedAt: "", cancellationReason: "", parentNoteId: id };
  const completed = await closeRecord(note, row, "Completed", "", child);
  return { note: completed, followUp: child };
}
export async function saveInterpretation(id: string, data: Pick<Note, "clientName" | "clientId" | "summary" | "type" | "priority" | "followUp" | "followUpDate" | "status">) {
  const { row } = await findNote(id);
  const tabId = await sheetId();
  const update = (column: number, values: string[]) => ({ updateCells: { range: { sheetId: tabId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: column, endColumnIndex: column + values.length }, rows: [{ values: values.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } });
  // Completed At remains human-controlled. The status formula respects completion
  // even if a concurrent AI response arrives after Mark Complete.
  const status = data.status === "Noted" ? "Noted" : "Pending";
  await request(":batchUpdate", { requests: [
    update(2, [data.clientName, data.clientId]),
    update(5, [data.summary, data.type, data.priority, data.followUp, data.followUpDate]),
    { updateCells: { range: { sheetId: tabId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 10, endColumnIndex: 11 }, rows: [{ values: [{ userEnteredValue: { formulaValue: `=IF(M${row}<>"","Cancelled",IF(L${row}<>"","Completed","${status}"))` } }] }], fields: "userEnteredValue" } },
  ] });
}
export async function readClientRegistry(): Promise<string[][]> {
  const data = await request(`/values/${encodeURIComponent("'Raw Data'!A:ZZ")}`, undefined, HISTORICAL_SPREADSHEET_ID);
  return data.values || [];
}
