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
import {
  getAssignmentCandidates,
  contractorDatabaseConfigured,
  listAllContractorAvailability,
  listApprovedAssignmentsForContractor,
  listAssignmentsForOwner,
  listAvailabilityForContractor,
  listContractorAccounts,
} from "../lib/contractors/database";
import { assignmentInputFromLead } from "../lib/contractors/assignmentSchedule";
import { OperationsPortalClient } from "./OperationsPortalClient";
import { ContractorPortalClient } from "./ContractorPortalClient";

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
  const allAvailability =
    user?.role === ROLE_OWNER && contractorDatabaseConfigured()
      ? await listAllContractorAvailability()
      : [];
  const ownerAssignments =
    user?.role === ROLE_OWNER && contractorDatabaseConfigured()
      ? await listAssignmentsForOwner()
      : [];
  const ownerAssignmentCandidates =
    user?.role === ROLE_OWNER && contractorDatabaseConfigured()
      ? Object.fromEntries(
          await Promise.all(
            activeJobs.map(async (lead) => {
              const input = assignmentInputFromLead(lead);
              return [lead.leadId, input ? await getAssignmentCandidates(input) : []];
            }),
          ),
        )
      : {};
  const contractorAvailability =
    user?.role === ROLE_CONTRACTOR && user.id && contractorDatabaseConfigured()
      ? await listAvailabilityForContractor(user.id)
      : [];
  const contractorAssignments =
    user?.role === ROLE_CONTRACTOR && user.id && contractorDatabaseConfigured()
      ? await listApprovedAssignmentsForContractor(user.id)
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
          <ContractorPortalClient
            assignments={contractorAssignments}
            availability={contractorAvailability}
            databaseConfigured={contractorDbConfigured}
            user={user}
          />
        ) : null}

        {user && user.role !== ROLE_CONTRACTOR ? (
          <OperationsPortalClient
            activeJobs={activeJobs}
            assignments={ownerAssignments}
            assignmentCandidates={ownerAssignmentCandidates}
            availability={allAvailability}
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
