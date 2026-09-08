import { cookies } from "next/headers";
import { SiteShell } from "../components/SiteShell";
import { getActiveJobs, getManualLeads, getRequestLeads } from "../lib/booking/google";
import {
  getAuthorizedOperationsUserAsync,
  isValidOwnerSession,
  operationsAuthConfigured,
  OPERATIONS_SESSION_ACTIVE_COOKIE,
  OPERATIONS_SESSION_COOKIE,
  OWNER_SESSION_ACTIVE_COOKIE,
  OWNER_SESSION_COOKIE,
  ROLE_OWNER,
  ROLE_CONTRACTOR,
  type OperationsUser,
} from "../lib/booking/ownerAuth";
import { contractorDatabaseConfigured, listContractorAccounts } from "../lib/contractors/database";
import { OperationsPortalClient } from "./OperationsPortalClient";

export default async function LoginPage() {
  const user = await getOperationsUserFromCookies();
  const configured = operationsAuthConfigured();
  const requests = user?.role === ROLE_OWNER ? await getRequestLeads() : [];
  const leads = user?.role === ROLE_OWNER ? await getManualLeads() : [];
  const activeJobs = user && user.role !== ROLE_CONTRACTOR ? await getActiveJobs() : [];
  const contractors =
    user?.role === ROLE_OWNER && contractorDatabaseConfigured()
      ? await listContractorAccounts()
      : [];
  const contractorDbConfigured = contractorDatabaseConfigured();

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
              <span>Email</span>
              <input autoComplete="username" name="email" type="email" />
            </label>
            <label className="field">
              <span>Password</span>
              <input autoComplete="current-password" name="token" type="password" />
            </label>
            <p className="form-hint">
              Owners and field managers can leave email blank and use the existing operations password.
            </p>
            <button className="button button--primary" type="submit">
              Open Operations Portal
            </button>
          </form>
        ) : null}

        {user?.role === ROLE_CONTRACTOR ? (
          <ContractorPortal user={user} />
        ) : null}

        {user && user.role !== ROLE_CONTRACTOR ? (
          <OperationsPortalClient
            activeJobs={activeJobs}
            contractors={contractors}
            contractorDbConfigured={contractorDbConfigured}
            leads={leads}
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
    const syntheticRequest = new Request("https://wadehomeservices.local/login", {
      headers: {
        cookie: [
          `${OPERATIONS_SESSION_COOKIE}=${encodeURIComponent(operationsSession ?? "")}`,
          `${OPERATIONS_SESSION_ACTIVE_COOKIE}=1`,
        ].join("; "),
      },
    });
    const user = await getAuthorizedOperationsUserAsync(syntheticRequest);
    if (user) return user;
  }

  const ownerSession = cookieStore.get(OWNER_SESSION_COOKIE)?.value;
  const ownerActive = cookieStore.get(OWNER_SESSION_ACTIVE_COOKIE)?.value === "1";
  if (ownerActive && isValidOwnerSession(ownerSession)) {
    return { role: ROLE_OWNER, label: "Owner" };
  }

  return null;
}

function ContractorPortal({ user }: { user: OperationsUser }) {
  return (
    <div className="operations-portal contractor-portal">
      <div className="operations-toolbar">
        <div>
          <p className="eyebrow">Contractor Portal</p>
          <h2>Welcome, {user.label}.</h2>
        </div>
        <form action="/api/session/logout" method="post">
          <button className="button button--dark" type="submit">Log Out</button>
        </form>
      </div>

      <section className="owner-lead">
        <h3>Confirmed Assignments</h3>
        <p className="portal-empty-copy">
          No confirmed assignments are available yet. When Wade Home Services assigns work to you,
          job-safe details will appear here.
        </p>
      </section>

      <section className="owner-lead">
        <h3>Availability</h3>
        <p className="portal-empty-copy">
          Availability entry is the next implementation phase. Regular availability and on-call
          windows will stay separate.
        </p>
      </section>

      <section className="owner-lead">
        <h3>Work History</h3>
        <p className="portal-empty-copy">
          Approved hours and previous shifts will appear here after the time-record phase is built.
        </p>
      </section>

      <ContractorLeadForm />
    </div>
  );
}

function ContractorLeadForm() {
  return (
    <form className="owner-lead" action="/api/contractor/leads" method="post">
      <h3>Submit a Lead</h3>
      <p className="portal-empty-copy">
        Send a prospective opportunity to Wade Home Services. Your account will be recorded as the
        submitting contractor.
      </p>
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input maxLength={160} name="name" required type="text" />
        </label>
        <label className="field">
          <span>Phone</span>
          <input inputMode="tel" name="phone" type="tel" />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" />
        </label>
        <label className="field">
          <span>Address</span>
          <input maxLength={240} name="streetAddress" type="text" />
        </label>
        <label className="field">
          <span>City</span>
          <input maxLength={120} name="city" type="text" />
        </label>
      </div>
      <label className="field">
        <span>Opportunity Info</span>
        <textarea maxLength={1400} name="opportunityInfo" required />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea maxLength={800} name="notes" />
      </label>
      <button className="button button--primary" type="submit">Submit Lead</button>
    </form>
  );
}
