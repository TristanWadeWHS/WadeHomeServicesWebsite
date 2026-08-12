import Link from "next/link";
import { SiteShell } from "../../components/SiteShell";
import { getPendingLeads } from "../../lib/booking/google";
import { isValidOwnerToken, ownerApprovalConfigured } from "../../lib/booking/ownerAuth";

type PageProps = {
  searchParams?: Promise<{ token?: string }> | { token?: string };
};

export default async function OwnerApprovalsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = params?.token ?? "";
  const authorized = isValidOwnerToken(token);
  const configured = ownerApprovalConfigured();
  const leads = authorized ? await getPendingLeads() : [];

  return (
    <SiteShell>
      <section className="subpage-hero subpage-hero--compact section">
        <p className="eyebrow">Owner Review</p>
        <h1 className="hero-heading">Pending booking requests.</h1>
        <p>Review requested times before anything is confirmed on the Calendar.</p>
      </section>

      <section className="owner-shell section">
        {!configured ? (
          <div className="owner-empty">
            <h2>Owner approval is not configured.</h2>
            <p>Set OWNER_APPROVAL_TOKEN in Vercel Preview before using this page.</p>
          </div>
        ) : null}

        {configured && !authorized ? (
          <form className="owner-auth" method="get">
            <label className="field">
              <span>Owner access token</span>
              <input name="token" type="password" />
            </label>
            <button className="button button--primary" type="submit">
              Review Requests
            </button>
          </form>
        ) : null}

        {authorized && leads.length === 0 ? (
          <div className="owner-empty">
            <h2>No pending requests.</h2>
            <p>New website requests with Pending Approval status will appear here.</p>
          </div>
        ) : null}

        {authorized ? (
          <div className="owner-lead-list">
            {leads.map((lead) => (
              <article className="owner-lead" key={lead.leadId}>
                <div className="owner-lead__header">
                  <div>
                    <p className="eyebrow">{lead.status}</p>
                    <h2>{lead.name}</h2>
                    <p>{lead.leadId}</p>
                  </div>
                  <Link className="button button--ghost" href={`/owner/approvals?token=${encodeURIComponent(token)}`}>
                    Refresh
                  </Link>
                </div>

                <dl className="owner-detail-grid">
                  <div><dt>Phone</dt><dd>{lead.phone}</dd></div>
                  <div><dt>Email</dt><dd>{lead.email}</dd></div>
                  <div><dt>Address</dt><dd>{lead.streetAddress}, {lead.city}, {lead.state} {lead.zip}</dd></div>
                  <div><dt>Service Type(s)</dt><dd>{lead.services}</dd></div>
                  <div><dt>Appointment Type</dt><dd>{lead.appointmentType}</dd></div>
                  <div><dt>Requested Time</dt><dd>{lead.requestedDate} / {lead.requestedTime}</dd></div>
                  <div><dt>Photo References</dt><dd>{lead.photoReferences || "None provided"}</dd></div>
                  <div><dt>Description</dt><dd>{lead.projectDescription}</dd></div>
                </dl>

                <div className="owner-actions">
                  <form action="/api/owner/booking/approve" method="post">
                    <input name="token" type="hidden" value={token} />
                    <input name="leadId" type="hidden" value={lead.leadId} />
                    <button className="button button--primary" type="submit">
                      Approve
                    </button>
                  </form>

                  <form action="/api/owner/booking/decline" method="post">
                    <input name="token" type="hidden" value={token} />
                    <input name="leadId" type="hidden" value={lead.leadId} />
                    <label className="field">
                      <span>Decline reason</span>
                      <select name="reason" defaultValue="Requested time unavailable">
                        <option>Requested time unavailable</option>
                        <option>Outside service area</option>
                        <option>Need more information</option>
                        <option>Unable to service project</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <button className="button button--dark" type="submit">
                      Decline
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </SiteShell>
  );
}
