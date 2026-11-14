import { EMAIL_SENDER, EMAIL_REPLY_TO } from "../email/identity";
import { createHash } from "node:crypto";
import { localDate, TIMEZONE, validDate, type Note } from "./model";

export type DigestSection = { title: string; notes: Note[] };
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function digestDueNow(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "2-digit", hourCycle: "h23" }).format(now) === "08";
}
export function selectDigest(notes: Note[], now = new Date()): DigestSection[] {
  const today = localDate(now), end = shiftDate(today, 7), stale = shiftDate(today, -14);
  const open = notes.filter(n => !n.completedAt && !["Completed", "Cancelled"].includes(n.status));
  const age = (n: Note) => { const date = new Date(n.timestamp); return Number.isNaN(date.getTime()) ? "" : localDate(date); };
  const dated = (n: Note) => n.followUp === "Yes" && validDate(n.followUpDate);
  const sort = (a: Note, b: Note) => (a.priority === "Urgent" ? 0 : a.priority === "High" ? 1 : 2) - (b.priority === "Urgent" ? 0 : b.priority === "High" ? 1 : 2) || (a.followUpDate || "9999").localeCompare(b.followUpDate || "9999") || a.timestamp.localeCompare(b.timestamp);
  const seen = new Set<string>();
  const section = (title: string, predicate: (note: Note) => boolean) => ({ title, notes: open.filter(n => predicate(n) && !seen.has(n.id)).sort(sort).map(n => { seen.add(n.id); return n; }) });
  return [
    section("High & urgent priorities", n => ["High", "Urgent"].includes(n.priority)),
    section("Other overdue follow-ups", n => dated(n) && n.followUpDate < today),
    section("Other follow-ups in the next 7 days", n => dated(n) && n.followUpDate >= today && n.followUpDate <= end),
    section("Other open notes older than 2 weeks", n => Boolean(age(n)) && age(n) < stale),
  ];
}
export function digestRecipients(value = process.env.COMMAND_CENTER_DIGEST_EMAILS) {
  const emails = [...new Set((value || "").split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length || emails.length > 20 || emails.some(email => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) throw new Error("Configure valid COMMAND_CENTER_DIGEST_EMAILS recipients.");
  return emails;
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function buildDigestPayload(notes: Note[], recipients: string[], now = new Date()) {
  const date = localDate(now), sections = selectDigest(notes, now);
  const portal = "https://www.wadehomeservices.com/login";
  const lines = (note: Note) => {
    const created = new Date(note.timestamp);
    const ageDays = Number.isNaN(created.getTime()) ? null : Math.round((Date.parse(date) - Date.parse(localDate(created))) / 86400000);
    const due = note.followUp === "Yes" && validDate(note.followUpDate) ? `Follow up ${note.followUpDate}${note.followUpDate < date ? " (OVERDUE)" : note.followUpDate === date ? " (TODAY)" : ""}` : "No follow-up date";
    const text = note.original.length > 1200 ? `${note.original.slice(0, 1200)}… [Full note in portal]` : note.original;
    return [`${note.clientName || "No client name"} · ${note.priority || "Normal"} priority`, `${due}${ageDays !== null && ageDays > 14 ? ` · Open ${ageDays} days` : ""}`, text];
  };
  const count = sections.reduce((total, section) => total + section.notes.length, 0);
  const intro = count ? `${count} open item${count === 1 ? "" : "s"} need attention. Each note appears once; high priorities stay at the top and repeat daily until closed.` : "No high priorities, overdue or upcoming follow-ups, or notes older than two weeks need attention today.";
  const textContent = [`WHS Command Center · ${date} (Pacific time)`, intro, ...sections.flatMap(section => [section.title, ...(section.notes.length ? section.notes.map(note => lines(note).join("\n")) : ["None."])]), "Older open notes are flagged by their creation date; this does not confirm a client has failed to respond.", `Open Command Center: ${portal}`].join("\n\n");
  const htmlContent = `<html><body style="margin:0;background:#f4f7f4;font-family:Arial,sans-serif;color:#183e2c"><main style="max-width:680px;margin:auto;padding:28px"><h1>Command Center</h1><p>${date} · Pacific time</p><p>${escape(intro)}</p>${sections.map(section => `<h2 style="font-size:20px">${escape(section.title)} (${section.notes.length})</h2>${section.notes.length ? section.notes.map(note => { const [title, detail, original] = lines(note); return `<article style="background:#fff;padding:16px;margin:12px 0;border:1px solid #d4ded8;border-radius:10px"><h3 style="margin:0 0 8px;font-size:17px">${escape(title)}</h3><p>${escape(detail)}</p><p style="white-space:pre-wrap">${escape(original)}</p></article>`; }).join("") : "<p>None.</p>"}`).join("")}<p style="font-size:12px;color:#526459">Older open notes are flagged by creation date; this does not confirm a client has failed to respond.</p><p><a href="${portal}" style="display:inline-block;background:#183e2c;color:#fff;padding:14px 20px;border-radius:8px">Open Command Center</a></p></main></body></html>`;
  // A stable provider idempotency key supplements the durable daily receipt.
  const hash = createHash("sha256").update(`whs-command-digest:${date}`).digest("hex");
  const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { sender: EMAIL_SENDER, replyTo: EMAIL_REPLY_TO, to: recipients.map(email => ({ email })), subject: `WHS Daily Priorities · ${date} · ${count} open items`, htmlContent, textContent, tags: ["command-center-daily-digest"], headers: { IdempotencyKey: key } };
}
