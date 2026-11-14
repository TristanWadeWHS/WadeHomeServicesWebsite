import { getGoogleAccessToken, HISTORICAL_SPREADSHEET_ID } from "../booking/google";
import { HEADERS, fromRow, toRow, localTimestamp, type Note, type NoteDetails } from "./model";

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
  const data = await request(`/values/${encodeURIComponent(`'${TAB}'!A:M`)}`);
  let rows: string[][] = data.values || [];
  if (rows.length === 0) {
    try {
      await request(":batchUpdate", { requests: [
        { addNamedRange: { namedRange: { namedRangeId: "cc_schema_v1", name: "CC_SCHEMA_V1", range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 13 } } } },
        { updateCells: { start: { sheetId: tabId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
      ] });
    } catch { /* A concurrent initializer may have won; verify below. */ }
    rows = (await request(`/values/${encodeURIComponent(`'${TAB}'!A:M`)}`)).values || [];
  }
  // Extend the existing 12-column schema without rewriting note rows.
  if (HEADERS.slice(0, 12).every((header, i) => rows[0]?.[i] === header) && !rows[0]?.[12]) {
    await request("/values:batchUpdate", { valueInputOption: "RAW", data: [{ range: `'${TAB}'!M1:M1`, values: [[HEADERS[12]]] }] });
    rows[0][12] = HEADERS[12];
  }
  if (HEADERS.some((header, i) => rows[0]?.[i] !== header)) throw new CommandCenterError("Notes History headers do not match the required Command Center schema.");
  return rows.slice(1).map(fromRow).filter(n => n.id);
}
async function sheetId() {
  const data = await request("?fields=properties(title),sheets(properties(sheetId,title,gridProperties(columnCount)))");
  // The owner-configured ID is authoritative. A spreadsheet's display title is
  // mutable and must not prevent initializing its dedicated Notes History tab.
  const sheet = data.sheets?.find((s: { properties: { title: string } }) => s.properties.title === TAB);
  if (!sheet) {
    try { await request(":batchUpdate", { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { columnCount: 13, frozenRowCount: 1 } } } }] }); }
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
export async function completeNote(id: string) {
  const { note, row } = await findNote(id);
  if (note.status === "Cancelled") throw new CommandCenterError("This note has already been cancelled.", 409);
  if (note.completedAt || note.status === "Completed") return note;
  const completedAt = localTimestamp();
  await request("/values:batchUpdate", { valueInputOption: "RAW", data: [{ range: `'${TAB}'!K${row}:L${row}`, values: [["Completed", completedAt]] }] });
  return { ...note, status: "Completed", completedAt };
}
export async function cancelNote(id: string, reason: unknown) {
  if (typeof reason !== "string" || !reason.trim() || reason.length > 2000) throw new CommandCenterError("Enter a cancellation reason of 1–2,000 characters.", 400);
  const { note, row } = await findNote(id);
  if (note.status === "Cancelled") return note;
  if (note.completedAt || note.status === "Completed") throw new CommandCenterError("This note has already been completed.", 409);
  const completedAt = localTimestamp();
  const cancellationReason = reason.trim();
  // The existing closure timestamp column is shared by completed/cancelled notes.
  await request("/values:batchUpdate", { valueInputOption: "RAW", data: [{ range: `'${TAB}'!K${row}:M${row}`, values: [["Cancelled", completedAt, cancellationReason]] }] });
  return { ...note, status: "Cancelled", completedAt, cancellationReason };
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
