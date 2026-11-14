export const HEADERS = ["Note ID", "Timestamp", "Client Name", "Client ID", "Original Note", "AI Summary", "Note Type", "Priority", "Follow-Up Required", "Follow-Up Date", "Status", "Completed At", "Cancellation Reason"] as const;
export const TIMEZONE = "America/Los_Angeles";
export type Note = { id: string; timestamp: string; clientName: string; clientId: string; original: string; summary: string; type: string; priority: string; followUp: string; followUpDate: string; status: string; completedAt: string; cancellationReason: string };
export function fromRow(row: string[]): Note {
  const [id = "", timestamp = "", clientName = "", clientId = "", original = "", summary = "", type = "", priority = "", followUp = "", followUpDate = "", status = "", completedAt = "", cancellationReason = ""] = row;
  return { id, timestamp, clientName, clientId, original, summary, type, priority, followUp, followUpDate, status, completedAt, cancellationReason };
}
export function toRow(n: Note): string[] { return [n.id, n.timestamp, n.clientName, n.clientId, n.original, n.summary, n.type, n.priority, n.followUp, n.followUpDate, n.status, n.completedAt, n.cancellationReason]; }
export function localDate(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function localTimestamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(now);
  const p = (name: string) => parts.find(x => x.type === name)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}${p("timeZoneName").replace("GMT", "") || "+00:00"}`;
}
export function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function groupNotes(notes: Note[], today = localDate()) {
  const pending = notes.filter(n => n.status !== "Completed" && n.status !== "Cancelled" && !n.completedAt);
  return {
    overdue: pending.filter(n => n.followUp === "Yes" && validDate(n.followUpDate) && n.followUpDate < today),
    upcoming: pending.filter(n => n.followUp === "Yes" && (!validDate(n.followUpDate) || n.followUpDate >= today)),
    general: pending.filter(n => n.followUp !== "Yes"),
    completed: notes.filter(n => n.status !== "Cancelled" && (n.status === "Completed" || n.completedAt)),
    cancelled: notes.filter(n => n.status === "Cancelled"),
  };
}
export function resolveClientId(name: string, original: string, rows: string[][]) {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const target = normalize(name);
  // Only explicit client identifiers count. Lead/job IDs are never substituted.
  const headers = rows[0] || [];
  const idIndex = headers.indexOf("Client ID");
  const nameIndex = ["Client Name", "Customer Name", "Name"].map(h => headers.indexOf(h)).find(i => i >= 0) ?? -1;
  if (idIndex < 0 || nameIndex < 0 || target.split(" ").length < 2 || !normalize(original).includes(target)) return "";
  const matches = rows.slice(1).filter(row => normalize(row[nameIndex] || "") === target);
  const ids = new Set(matches.map(row => row[idIndex]?.trim() || ""));
  return ids.size === 1 && !ids.has("") ? [...ids][0] : "";
}

export const CATEGORIES = ["General", "Client follow-up", "Estimate / Quote", "Scheduling", "Payment", "Operations", "Idea"] as const;
export const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export type NoteDetails = { clientName: string; type: string; priority: string; followUpDate: string };
export function validateDetails(value: unknown): NoteDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose valid note details.");
  const v = value as Record<string, unknown>;
  if (typeof v.clientName !== "string" || v.clientName.length > 200 || !CATEGORIES.includes(v.type as typeof CATEGORIES[number]) || !PRIORITIES.includes(v.priority as typeof PRIORITIES[number]) || (v.followUpDate !== "" && !validDate(v.followUpDate))) throw new Error("Check the client name, category, priority, and follow-up date.");
  return { clientName: v.clientName.trim(), type: v.type as string, priority: v.priority as string, followUpDate: v.followUpDate as string };
}
