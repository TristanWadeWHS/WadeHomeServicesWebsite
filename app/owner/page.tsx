import { cookies } from "next/headers";
import { SiteShell } from "../components/SiteShell";
import { getPendingLeads } from "../lib/booking/google";
import {
  isValidOwnerSession,
  OWNER_SESSION_ACTIVE_COOKIE,
  OWNER_SESSION_COOKIE,
  ownerApprovalConfigured,
} from "../lib/booking/ownerAuth";
import { OwnerApprovalsClient } from "./OwnerApprovalsClient";

export default async function OwnerPage() {
  const cookieStore = await cookies();
  const authorized =
    cookieStore.get(OWNER_SESSION_ACTIVE_COOKIE)?.value === "1" &&
    isValidOwnerSession(cookieStore.get(OWNER_SESSION_COOKIE)?.value);
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
            <p>Owner approval needs to be configured before this page can be used.</p>
          </div>
        ) : null}

        {configured && !authorized ? (
          <form className="owner-auth" action="/api/owner/session/login" method="post">
            <label className="field">
              <span>Owner access token</span>
              <input name="token" type="password" />
            </label>
            <button className="button button--primary" type="submit">
              Review Requests
            </button>
          </form>
        ) : null}

        {authorized ? <OwnerApprovalsClient initialLeads={leads} /> : null}
      </section>
    </SiteShell>
  );
}
