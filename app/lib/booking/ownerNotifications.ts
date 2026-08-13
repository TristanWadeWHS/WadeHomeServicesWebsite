import type { NormalizedLead } from "./types";

type OwnerNotificationResult =
  | { ok: true; skipped?: false }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; reason: string };

const RESEND_API_URL = "https://api.resend.com/emails";

export function ownerNotificationConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.OWNER_NOTIFICATION_EMAIL &&
      process.env.OWNER_NOTIFICATION_FROM,
  );
}

export async function sendOwnerNewLeadNotification(
  leadId: string,
  lead: NormalizedLead,
): Promise<OwnerNotificationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.OWNER_NOTIFICATION_EMAIL;
  const from = process.env.OWNER_NOTIFICATION_FROM;
  if (!apiKey || !to || !from) {
    return {
      ok: false,
      skipped: true,
      reason:
        "Owner notification email is not configured. Set RESEND_API_KEY, OWNER_NOTIFICATION_EMAIL, and OWNER_NOTIFICATION_FROM.",
    };
  }

  const portalUrl = ownerApprovalPortalUrl();
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `New Wade Home Services booking request: ${leadId}`,
      html: ownerNotificationHtml(leadId, lead, portalUrl),
      text: ownerNotificationText(leadId, lead, portalUrl),
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: `Owner notification email failed with ${response.status}.` };
  }

  return { ok: true };
}

function ownerApprovalPortalUrl() {
  const explicit = process.env.OWNER_APPROVAL_PORTAL_URL;
  if (explicit) return explicit;

  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (publicSiteUrl) return `${trimTrailingSlash(publicSiteUrl)}/owner/approvals`;

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelUrl) return `https://${trimTrailingSlash(vercelUrl)}/owner/approvals`;

  return "/owner/approvals";
}

function ownerNotificationHtml(
  leadId: string,
  lead: NormalizedLead,
  portalUrl: string,
) {
  const rows = [
    ["Lead ID", leadId],
    ["Customer name", lead.customer.name],
    ["Phone", lead.customer.phone],
    ["Email", lead.normalizedEmail],
    ["Service type(s)", lead.services.join(", ")],
    ["Requested date", new Date(lead.requestedSlot.start).toISOString().slice(0, 10)],
    ["Requested time", lead.requestedSlot.label],
  ];

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f2;color:#202724;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:640px;margin:0 auto;padding:28px 18px;">
      <section style="background:#ffffff;border:1px solid #d8ddd7;border-radius:8px;padding:24px;">
        <p style="color:#4f705d;font-size:12px;font-weight:800;letter-spacing:.08em;margin:0 0 8px;text-transform:uppercase;">New booking request</p>
        <h1 style="color:#08251d;font-size:24px;line-height:1.2;margin:0 0 18px;">Wade Home Services lead needs review</h1>
        <table style="border-collapse:collapse;width:100%;">
          ${rows
            .map(
              ([label, value]) => `<tr>
                <th style="border-top:1px solid #d8ddd7;color:#123f2f;font-size:12px;padding:12px 8px;text-align:left;text-transform:uppercase;width:170px;">${escapeHtml(label)}</th>
                <td style="border-top:1px solid #d8ddd7;padding:12px 8px;">${escapeHtml(value)}</td>
              </tr>`,
            )
            .join("")}
        </table>
        <h2 style="color:#08251d;font-size:16px;margin:22px 0 8px;">Project description</h2>
        <p style="white-space:pre-line;">${escapeHtml(lead.projectDescription)}</p>
        <p style="margin:24px 0 0;">
          <a href="${escapeHtml(portalUrl)}" style="background:#123f2f;border-radius:6px;color:#ffffff;display:inline-block;font-weight:800;padding:12px 16px;text-decoration:none;">Open owner approval portal</a>
        </p>
      </section>
    </main>
  </body>
</html>`;
}

function ownerNotificationText(
  leadId: string,
  lead: NormalizedLead,
  portalUrl: string,
) {
  return [
    "New Wade Home Services booking request",
    "",
    `Lead ID: ${leadId}`,
    `Customer name: ${lead.customer.name}`,
    `Phone: ${lead.customer.phone}`,
    `Email: ${lead.normalizedEmail}`,
    `Service type(s): ${lead.services.join(", ")}`,
    `Project description: ${lead.projectDescription}`,
    `Requested date: ${new Date(lead.requestedSlot.start).toISOString().slice(0, 10)}`,
    `Requested time: ${lead.requestedSlot.label}`,
    `Owner approval portal: ${portalUrl}`,
  ].join("\n");
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
