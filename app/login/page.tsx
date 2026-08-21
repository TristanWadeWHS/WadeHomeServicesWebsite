import { cookies } from "next/headers";
import { SiteShell } from "../components/SiteShell";
import { getActiveJobs, getRequestLeads } from "../lib/booking/google";
import {
  isValidOwnerSession,
  operationsAuthConfigured,
  OPERATIONS_SESSION_ACTIVE_COOKIE,
  OPERATIONS_SESSION_COOKIE,
  OWNER_SESSION_ACTIVE_COOKIE,
  OWNER_SESSION_COOKIE,
  ROLE_OWNER,
  type OperationsUser,
  verifyOperationsSession,
} from "../lib/booking/ownerAuth";
import { OperationsPortalClient } from "./OperationsPortalClient";

export default async function LoginPage() {
  const user = await getOperationsUserFromCookies();
  const configured = operationsAuthConfigured();
  const requests = user?.role === ROLE_OWNER ? await getRequestLeads() : [];
  const activeJobs = user ? await getActiveJobs() : [];

  return (
    <SiteShell>
      <section className="subpage-hero subpage-hero--compact section">
        <p className="eyebrow">Operations Portal</p>
        <h1 className="hero-heading">Wade Home Services operations.</h1>
        <p>Review booking requests, manage active jobs, and close out completed work.</p>
      </section>

      <section className="owner-shell section">
        {!configured ? (
          <div className="owner-empty">
            <h2>Operations access is not configured.</h2>
            <p>Configure the owner and field manager access tokens before this portal is used.</p>
          </div>
        ) : null}

        {configured && !user ? (
          <form className="owner-auth" action="/api/session/login" method="post">
            <label className="field">
              <span>Access token</span>
              <input autoComplete="current-password" name="token" type="password" />
            </label>
            <button className="button button--primary" type="submit">
              Open Operations Portal
            </button>
          </form>
        ) : null}

        {user ? (
          <OperationsPortalClient
            activeJobs={activeJobs}
            requests={requests}
            user={user}
          />
        ) : null}
      </section>
    </SiteShell>
  );
}

async function getOperationsUserFromCookies(): Promise<OperationsUser | null> {
  const cookieStore = await cookies();
  const operationsSession = cookieStore.get(OPERATIONS_SESSION_COOKIE)?.value;
  const operationsActive = cookieStore.get(OPERATIONS_SESSION_ACTIVE_COOKIE)?.value === "1";
  if (operationsActive) {
    const user = verifyOperationsSession(operationsSession);
    if (user) return user;
  }

  const ownerSession = cookieStore.get(OWNER_SESSION_COOKIE)?.value;
  const ownerActive = cookieStore.get(OWNER_SESSION_ACTIVE_COOKIE)?.value === "1";
  if (ownerActive && isValidOwnerSession(ownerSession)) {
    return { role: ROLE_OWNER, label: "Owner" };
  }

  return null;
}
