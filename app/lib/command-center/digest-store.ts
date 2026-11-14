import { randomUUID } from "node:crypto";
import { commandCenterRequest as request, CommandCenterError } from "./store";
import { localTimestamp } from "./model";

const TAB = "Daily Digests";
const HEADERS = ["Run ID", "Local Date", "Status", "Started At", "Sent At", "Provider Message ID", "Recipient Count", "Error Code"];
export type DigestReceipt = { runId: string; date: string; status: string; startedAt: string; sentAt: string; messageId: string; recipientCount: string; errorCode: string };
const parse = (row: string[]): DigestReceipt => { const [runId = "", date = "", status = "", startedAt = "", sentAt = "", messageId = "", recipientCount = "", errorCode = ""] = row; return { runId, date, status, startedAt, sentAt, messageId, recipientCount, errorCode }; };
async function ledger() {
  let meta = await request("?fields=sheets(properties(sheetId,title))");
  let sheet = meta.sheets?.find((s: { properties: { title: string } }) => s.properties.title === TAB);
  if (!sheet) {
    try { await request(":batchUpdate", { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { columnCount: 8, frozenRowCount: 1 } } } }] }); } catch { /* Verify a concurrent creation. */ }
    meta = await request("?fields=sheets(properties(sheetId,title))");
    sheet = meta.sheets?.find((s: { properties: { title: string } }) => s.properties.title === TAB);
    if (!sheet) throw new CommandCenterError("Could not initialize daily digest receipts.");
  }
  const range = encodeURIComponent(`'${TAB}'!A:H`);
  let rows: string[][] = (await request(`/values/${range}`)).values || [];
  if (!rows.length) {
    try { await request(":batchUpdate", { requests: [
      { addNamedRange: { namedRange: { namedRangeId: "cc_digest_schema_v1", name: "CC_DIGEST_SCHEMA_V1", range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 } } } },
      { updateCells: { start: { sheetId: sheet.properties.sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
    ] }); } catch { /* Verify a concurrent initialization. */ }
    rows = (await request(`/values/${range}`)).values || [];
  }
  if (HEADERS.some((header, i) => rows[0]?.[i] !== header)) throw new CommandCenterError("Daily Digests headers do not match the required schema.");
  return { sheetId: sheet.properties.sheetId as number, rows };
}
export async function latestDigestReceipt() {
  const { rows } = await ledger();
  return rows.length > 1 ? parse(rows[rows.length - 1]) : null;
}
export async function claimDailyDigest(date: string, recipientCount: number) {
  const { rows, sheetId } = await ledger();
  const existing = rows.slice(1).find(row => row[1] === date);
  if (existing) return { claimed: false, receipt: parse(existing) };
  const runId = randomUUID();
  const values = [runId, date, "Sending", localTimestamp(), "", "", String(recipientCount), ""];
  try {
    await request(":batchUpdate", { requests: [
      { addNamedRange: { namedRange: { namedRangeId: `cc_digest_${date.replaceAll("-", "_")}`, name: `CC_DIGEST_${date.replaceAll("-", "_")}`, range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 } } } },
      { appendCells: { sheetId, rows: [{ values: values.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
    ] });
    return { claimed: true, receipt: parse(values) };
  } catch (error) {
    const saved = (await ledger()).rows.slice(1).find(row => row[1] === date);
    if (!saved) throw error;
    return { claimed: saved[0] === runId, receipt: parse(saved) };
  }
}
export async function finishDailyDigest(receipt: DigestReceipt, status: "Sent" | "Failed" | "Uncertain", messageId = "", errorCode = "") {
  const { rows } = await ledger();
  const row = rows.findIndex(values => values[0] === receipt.runId) + 1;
  if (row < 2) throw new CommandCenterError("Daily digest receipt could not be found.");
  await request("/values:batchUpdate", { valueInputOption: "RAW", data: [{ range: `'${TAB}'!C${row}:H${row}`, values: [[status, receipt.startedAt, status === "Sent" ? localTimestamp() : "", messageId, receipt.recipientCount, errorCode]] }] });
}
