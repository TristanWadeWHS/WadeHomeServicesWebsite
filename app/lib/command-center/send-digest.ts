import { readNotes, CommandCenterError } from "./store";
import { localDate } from "./model";
import { buildDigestPayload, digestRecipients } from "./digest";
import { claimDailyDigest, finishDailyDigest } from "./digest-store";

async function sendDigest(now: Date, testId?: string) {
  if (process.env.VERCEL_ENV !== "production") throw new CommandCenterError("Daily digest delivery is enabled only in production.", 409);
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new CommandCenterError("Daily digest email service is not configured.");
  let recipients: string[];
  try { recipients = digestRecipients(); } catch { throw new CommandCenterError("Set COMMAND_CENTER_DIGEST_EMAILS to the approved recipient addresses."); }
  const notes = await readNotes();
  const payload = buildDigestPayload(notes, recipients, now);
  if (testId) { payload.subject = `[TEST] ${payload.subject}`; payload.headers.IdempotencyKey = testId; }
  const claim = testId ? null : await claimDailyDigest(localDate(now), recipients.length);
  if (claim && !claim.claimed) {
    if (claim.receipt.status === "Sent") return { sent: false, skipped: true, message: "Today's digest has already been sent." };
    throw new CommandCenterError(`Today's digest is ${claim.receipt.status.toLowerCase()}. Review the delivery receipt before retrying to avoid duplicate email.`, 409);
  }
  let response: Response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", "api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    if (claim) await finishDailyDigest(claim.receipt, "Uncertain", "", "NETWORK_OR_TIMEOUT");
    throw new CommandCenterError("Email delivery could not be confirmed. Check the provider before attempting another send.");
  }
  if (!response.ok) {
    if (claim) await finishDailyDigest(claim.receipt, "Failed", "", `HTTP_${response.status}`);
    throw new CommandCenterError("The email service did not accept today's digest. Check the Daily Digests receipt and provider logs.");
  }
  let messageId = "";
  try { const body = await response.json(); if (typeof body.messageId === "string") messageId = body.messageId; } catch { /* A successful status still confirms provider acceptance. */ }
  if (claim) await finishDailyDigest(claim.receipt, "Sent", messageId);
  return { sent: true, recipientCount: recipients.length, message: testId ? "Test digest accepted by the email service. The daily schedule is unchanged." : "Today's digest was accepted by the email service." };
}

export async function sendDailyDigest(now = new Date()) { return sendDigest(now); }
export async function sendTestDigest(requestId: unknown, now = new Date()) {
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new CommandCenterError("Invalid test email request key.", 400);
  return sendDigest(now, requestId);
}
