"use client";

import { type KeyboardEvent, useState } from "react";
import {
  APPROVED_STATUS,
  CLOSED_STATUS,
  CONFLICT_STATUS,
  COMPLETED_STATUS,
  DECLINED_STATUS,
  IN_PROGRESS_STATUS,
  LEAD_STATUS,
  MANUAL_LEAD_SOURCE,
  MANUAL_LEAD_STATUS,
} from "../lib/booking/config";
import { ROLE_OWNER, type OperationsUser } from "../lib/booking/ownerAuth";
import {
  ASSIGNMENT_STATUS_APPROVED,
  ASSIGNMENT_STATUS_CANCELED,
  ASSIGNMENT_STATUS_CONFLICT_REVIEW,
  ASSIGNMENT_STATUS_PROPOSED,
  ASSIGNMENT_STATUS_REJECTED,
  AVAILABILITY_TYPE_DESIGNATED_SHIFT,
  type AssignmentCandidate,
  type ContractorAccount,
  type ContractorAssignment,
  type ContractorAvailability,
} from "../lib/contractors/types";
import {
  availabilityScheduleLabel,
  availabilityTypeLabel,
} from "./ContractorPortalClient";
import type { OwnerDecisionResult, SheetLead } from "../lib/booking/types";

type OperationsPortalClientProps = {
  activeJobs: SheetLead[];
  assignments: ContractorAssignment[];
  assignmentCandidates: Record<string, AssignmentCandidate[]>;
  availability: ContractorAvailability[];
  contractorDbConfigured: boolean;
  contractors: ContractorAccount[];
  leads: SheetLead[];
  requests: SheetLead[];
  user: OperationsUser;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

type BusyAction = {
  leadId: string;
  action: string;
} | null;

type PortalTab = "requests" | "active" | "leads";
type OwnerPortalTab = PortalTab | "contractors" | "availability";
type LeadAction = "convert" | "decline";

type OperationsResult = {
  ok: boolean;
  message?: string;
  lead?: SheetLead;
  details?: { lead?: SheetLead };
};

type ManualLeadForm = {
  name: string;
  opportunityInfo: string;
  phone: string;
  email: string;
  streetAddress: string;
  city: string;
  notes: string;
};

const emptyManualLead: ManualLeadForm = {
  name: "",
  opportunityInfo: "",
  phone: "",
  email: "",
  streetAddress: "",
  city: "",
  notes: "",
};

export function OperationsPortalClient({
  activeJobs,
  assignments,
  assignmentCandidates,
  availability,
  contractorDbConfigured,
  contractors,
  leads,
  requests,
  user,
}: OperationsPortalClientProps) {
  const [requestLeads, setRequestLeads] = useState(requests);
  const [jobLeads, setJobLeads] = useState(activeJobs);
  const [manualLeads, setManualLeads] = useState(leads);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [manualLead, setManualLead] = useState<ManualLeadForm>(emptyManualLead);
  const [contractorAccounts, setContractorAccounts] = useState(contractors);
  const [assignmentRows, setAssignmentRows] = useState(assignments);
  const [assignmentCandidateRows, setAssignmentCandidateRows] = useState(assignmentCandidates);
  const [availabilityRows, setAvailabilityRows] = useState(availability);
  const [availabilityFilter, setAvailabilityFilter] = useState({ contractorId: "", availabilityType: "" });
  const [designatedShift, setDesignatedShift] = useState({
    contractorId: contractors[0]?.id ?? "",
    availabilityType: AVAILABILITY_TYPE_DESIGNATED_SHIFT,
    availabilityDate: "",
    startTime: "08:00",
    endTime: "17:00",
    notes: "",
  });
  const [contractorForm, setContractorForm] = useState({
    displayName: "",
    email: "",
    temporaryPassword: "",
  });
  const isOwner = user.role === ROLE_OWNER;
  const [activeTab, setActiveTab] = useState<OwnerPortalTab>(isOwner ? "requests" : "active");
  const availableTabs: OwnerPortalTab[] = isOwner
    ? ["requests", "active", "leads", "contractors", "availability"]
    : ["active"];

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = availableTabs.indexOf(activeTab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? availableTabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % availableTabs.length
            : (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    setActiveTab(availableTabs[nextIndex]);
  }

  function upsertLead(updatedLead: SheetLead) {
    setRequestLeads((current) => {
      const isRequest = [LEAD_STATUS, CONFLICT_STATUS].includes(updatedLead.status);
      const exists = current.some((lead) => lead.leadId === updatedLead.leadId);
      if (!isRequest) {
        return current.filter((lead) => lead.leadId !== updatedLead.leadId);
      }
      if (exists) {
        return current.map((lead) => (lead.leadId === updatedLead.leadId ? updatedLead : lead));
      }
      return [updatedLead, ...current];
    });
    setJobLeads((current) => {
      const isActive = [APPROVED_STATUS, IN_PROGRESS_STATUS].includes(updatedLead.status);
      const exists = current.some((lead) => lead.leadId === updatedLead.leadId);
      if (!isActive) {
        return current.filter((lead) => lead.leadId !== updatedLead.leadId);
      }
      if (exists) {
        return current.map((lead) => (lead.leadId === updatedLead.leadId ? updatedLead : lead));
      }
      return [updatedLead, ...current];
    });
    setManualLeads((current) => {
      const exists = current.some((lead) => lead.leadId === updatedLead.leadId);
      if (updatedLead.source !== MANUAL_LEAD_SOURCE && updatedLead.status !== MANUAL_LEAD_STATUS) {
        return current.filter((lead) => lead.leadId !== updatedLead.leadId);
      }
      if (exists) {
        return current.map((lead) => (lead.leadId === updatedLead.leadId ? updatedLead : lead));
      }
      return [updatedLead, ...current];
    });
  }

  async function createManualLead() {
    setNotice(null);
    setBusyAction({ leadId: "manual-lead", action: "create" });
    try {
      const response = await fetch("/api/owner/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualLead),
        credentials: "same-origin",
      });
      const payload = await readJson(response);
      const createdLead = responseLead(payload);

      if (!response.ok || !payload?.ok || !createdLead) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }

      upsertLead(createdLead);
      setManualLead(emptyManualLead);
      setShowLeadForm(false);
      setActiveTab("leads");
      setNotice({ tone: "success", message: "Lead created." });
    } catch {
      setNotice({ tone: "error", message: "Lead could not be created. Please try again." });
    } finally {
      setBusyAction(null);
    }
  }

  async function createContractorAccount() {
    setNotice(null);
    setBusyAction({ leadId: "contractor-account", action: "create" });
    try {
      const response = await fetch("/api/owner/contractors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contractorForm),
        credentials: "same-origin",
      });
      const payload = await readJson(response) as ContractorResult | null;
      const contractor = payload?.contractor;
      if (!response.ok || !payload?.ok || !contractor) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }
      setContractorAccounts((current) => [contractor, ...current]);
      setContractorForm({ displayName: "", email: "", temporaryPassword: "" });
      setNotice({ tone: "success", message: "Contractor account created." });
    } catch {
      setNotice({ tone: "error", message: "Contractor account could not be created." });
    } finally {
      setBusyAction(null);
    }
  }

  async function deactivateContractorAccount(contractorId: string) {
    setNotice(null);
    setBusyAction({ leadId: contractorId, action: "deactivate-contractor" });
    const form = new FormData();
    form.set("contractorId", contractorId);
    try {
      const response = await fetch("/api/owner/contractors/deactivate", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = await readJson(response) as ContractorResult | null;
      const contractor = payload?.contractor;
      if (contractor) {
        setContractorAccounts((current) =>
          current.map((account) =>
            account.id === contractor.id ? contractor : account,
          ),
        );
      }
      if (!response.ok || !payload?.ok) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }
      setNotice({ tone: "success", message: "Contractor account deactivated." });
    } catch {
      setNotice({ tone: "error", message: "Contractor account could not be updated." });
    } finally {
      setBusyAction(null);
    }
  }

  async function createDesignatedShift() {
    setNotice(null);
    setBusyAction({ leadId: "owner-availability", action: "create" });
    try {
      const response = await fetch("/api/owner/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(designatedShift),
        credentials: "same-origin",
      });
      const payload = await readJson(response) as AvailabilityResult | null;
      const savedAvailability = payload?.availability;
      if (!response.ok || !payload?.ok || !savedAvailability) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }
      setAvailabilityRows((current) => upsertAvailability(current, savedAvailability));
      setDesignatedShift({
        contractorId: designatedShift.contractorId,
        availabilityType: AVAILABILITY_TYPE_DESIGNATED_SHIFT,
        availabilityDate: "",
        startTime: "08:00",
        endTime: "17:00",
        notes: "",
      });
      setNotice({ tone: "success", message: "Designated shift saved." });
    } catch {
      setNotice({ tone: "error", message: "Designated shift could not be saved." });
    } finally {
      setBusyAction(null);
    }
  }

  async function withdrawOwnerAvailability(availabilityId: string) {
    setNotice(null);
    setBusyAction({ leadId: availabilityId, action: "withdraw-availability" });
    try {
      const response = await fetch("/api/owner/availability", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availabilityId }),
        credentials: "same-origin",
      });
      const payload = await readJson(response) as AvailabilityResult | null;
      const withdrawnAvailability = payload?.availability;
      if (withdrawnAvailability) {
        setAvailabilityRows((current) => upsertAvailability(current, withdrawnAvailability));
      }
      if (!response.ok || !payload?.ok) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }
      setNotice({ tone: "success", message: "Availability withdrawn." });
    } catch {
      setNotice({ tone: "error", message: "Availability could not be withdrawn." });
    } finally {
      setBusyAction(null);
    }
  }

  async function updateCrewAssignment(
    lead: SheetLead,
    action: "propose" | "approve" | "reject" | "cancel",
    values: {
      contractorIds?: string[];
      requiredCrewSize?: string;
      assignmentDate?: string;
      assignmentStartTime?: string;
      assignmentEndTime?: string;
      travelBufferMinutes?: string;
      travelBufferOverride?: boolean;
      note?: string;
    },
  ) {
    setNotice(null);
    setBusyAction({ leadId: lead.leadId, action: `crew-${action}` });
    try {
      const response = await fetch("/api/owner/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          leadId: lead.leadId,
          contractorIds: values.contractorIds ?? [],
          requiredCrewSize: Number(values.requiredCrewSize || 1),
          assignmentDate: values.assignmentDate ?? "",
          assignmentStartTime: values.assignmentStartTime ?? "",
          assignmentEndTime: values.assignmentEndTime ?? "",
          travelBufferMinutes: Number(values.travelBufferMinutes || 30),
          travelBufferOverride: Boolean(values.travelBufferOverride),
          note: values.note ?? "",
        }),
        credentials: "same-origin",
      });
      const payload = await readJson(response) as AssignmentResult | null;
      if (payload?.assignments) {
        setAssignmentRows((current) =>
          replaceLeadAssignments(current, lead.leadId, payload.assignments ?? []),
        );
      }
      if (payload?.candidates) {
        setAssignmentCandidateRows((current) => ({
          ...current,
          [lead.leadId]: payload.candidates ?? [],
        }));
      }
      if (!response.ok || !payload?.ok) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }
      setNotice({ tone: "success", message: crewActionSuccess(action) });
    } catch {
      setNotice({ tone: "error", message: "Crew assignment could not be updated." });
    } finally {
      setBusyAction(null);
    }
  }

  async function updateManualLead(
    leadId: string,
    action: LeadAction,
    values: Record<string, string>,
  ) {
    setNotice(null);
    setBusyAction({ leadId, action });
    const form = new FormData();
    form.set("leadId", leadId);
    for (const [key, value] of Object.entries(values)) form.set(key, value);

    try {
      const response = await fetch(`/api/owner/leads/${action}`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = await readJson(response);
      const updatedLead = responseLead(payload);
      if (updatedLead) upsertLead(updatedLead);

      if (!response.ok || !payload?.ok) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }

      setNotice({
        tone: "success",
        message: action === "convert" ? "Lead converted to active job." : "Lead declined.",
      });
      if (action === "convert") setActiveTab("active");
    } catch {
      setNotice({ tone: "error", message: "This lead could not be updated. Please try again." });
    } finally {
      setBusyAction(null);
    }
  }

  async function decideLead(
    leadId: string,
    action: "approve" | "decline" | "close",
    values: Record<string, string>,
  ) {
    setNotice(null);
    setBusyAction({ leadId, action });
    const form = new FormData();
    form.set("leadId", leadId);
    for (const [key, value] of Object.entries(values)) form.set(key, value);

    try {
      const response = await fetch(`/api/owner/booking/${action}`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = await readJson(response);
      const updatedLead = responseLead(payload);
      if (updatedLead) upsertLead(updatedLead);

      if (!response.ok || !payload?.ok) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }

      setNotice({
        tone: "success",
        message: decisionSuccessMessage(action),
      });
      if (action === "approve") setActiveTab("active");
    } catch {
      setNotice({ tone: "error", message: "This request could not be updated. Please try again." });
    } finally {
      setBusyAction(null);
    }
  }

  async function mutateJob(
    leadId: string,
    action: "status" | "complete",
    values: Record<string, string>,
  ) {
    setNotice(null);
    setBusyAction({ leadId, action });
    const form = new FormData();
    form.set("leadId", leadId);
    for (const [key, value] of Object.entries(values)) form.set(key, value);

    try {
      const response = await fetch(`/api/operations/job/${action}`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = await readJson(response);
      const updatedLead = responseLead(payload);
      if (updatedLead) upsertLead(updatedLead);

      if (!response.ok || !payload?.ok) {
        setNotice({ tone: "error", message: friendlyError(payload) });
        return;
      }

      setNotice({
        tone: "success",
        message: action === "complete" ? "Job completed and transferred." : "Job status updated.",
      });
    } catch {
      setNotice({ tone: "error", message: "This job could not be updated. Please try again." });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="operations-portal">
      <div className="operations-toolbar">
        <div>
          <p className="eyebrow">{user.label}</p>
          <h2>Operations Dashboard</h2>
        </div>
        <div className="owner-actions owner-actions--compact">
          <a className="button button--ghost" href="/login">Refresh</a>
          <form action="/api/session/logout" method="post">
            <button className="button button--dark" type="submit">Log Out</button>
          </form>
        </div>
      </div>

      {notice ? (
        <div
          className={`owner-notice owner-notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="operations-tabs" role="tablist" aria-label="Operations workflows">
        {isOwner ? (
          <button
            aria-controls="operations-panel-requests"
            aria-selected={activeTab === "requests"}
            className="operations-tab"
            id="operations-tab-requests"
            onKeyDown={handleTabKeyDown}
            onClick={() => setActiveTab("requests")}
            role="tab"
            type="button"
          >
            Requests
          </button>
        ) : null}
        <button
          aria-controls="operations-panel-active"
          aria-selected={activeTab === "active"}
          className="operations-tab"
          id="operations-tab-active"
          onKeyDown={handleTabKeyDown}
          onClick={() => setActiveTab("active")}
          role="tab"
          type="button"
        >
          Active Jobs
        </button>
        {isOwner ? (
          <button
            aria-controls="operations-panel-leads"
            aria-selected={activeTab === "leads"}
            className="operations-tab"
            id="operations-tab-leads"
            onKeyDown={handleTabKeyDown}
            onClick={() => setActiveTab("leads")}
            role="tab"
            type="button"
          >
            Leads
          </button>
        ) : null}
        {isOwner ? (
          <button
            aria-controls="operations-panel-contractors"
            aria-selected={activeTab === "contractors"}
            className="operations-tab"
            id="operations-tab-contractors"
            onKeyDown={handleTabKeyDown}
            onClick={() => setActiveTab("contractors")}
            role="tab"
            type="button"
          >
            Contractors
          </button>
        ) : null}
        {isOwner ? (
          <button
            aria-controls="operations-panel-availability"
            aria-selected={activeTab === "availability"}
            className="operations-tab"
            id="operations-tab-availability"
            onKeyDown={handleTabKeyDown}
            onClick={() => setActiveTab("availability")}
            role="tab"
            type="button"
          >
            Availability
          </button>
        ) : null}
      </div>

      {isOwner && activeTab === "requests" ? (
        <section className="operations-section" id="operations-panel-requests" role="tabpanel" aria-labelledby="operations-tab-requests">
          <div className="operations-section__header">
            <h3>Requests</h3>
            <p>Approve with an approved amount, or decline requests that cannot be served.</p>
          </div>
          {requestLeads.length === 0 ? (
            <div className="owner-empty">
              <h2>No pending requests.</h2>
              <p>New website requests with Pending Approval status will appear here.</p>
            </div>
          ) : null}
          {requestLeads.map((lead) => (
            <RequestCard
              busyAction={busyAction}
              key={lead.leadId}
              lead={lead}
              onDecide={decideLead}
            />
          ))}
        </section>
      ) : null}

      {activeTab === "active" ? (
      <section className="operations-section" id="operations-panel-active" role="tabpanel" aria-labelledby="operations-tab-active">
        <div className="operations-section__header">
          <h3>Active Jobs</h3>
          <p>Track scheduled work, field progress, and completion closeout.</p>
        </div>
        {jobLeads.length === 0 ? (
          <div className="owner-empty">
            <h2>No active jobs.</h2>
            <p>Approved requests will appear here after owner review.</p>
          </div>
        ) : null}
        {jobLeads.map((lead) => (
          <JobCard
            assignments={assignmentRows.filter((assignment) => assignment.leadId === lead.leadId)}
            busyAction={busyAction}
            candidates={assignmentCandidateRows[lead.leadId] ?? []}
            contractorDbConfigured={contractorDbConfigured}
            contractors={contractorAccounts}
            isOwner={isOwner}
            key={lead.leadId}
            lead={lead}
            onCrewUpdate={updateCrewAssignment}
            onMutate={mutateJob}
          />
        ))}
      </section>
      ) : null}

      {isOwner && activeTab === "leads" ? (
        <section className="operations-section" id="operations-panel-leads" role="tabpanel" aria-labelledby="operations-tab-leads">
          <div className="operations-section__header">
            <div>
              <h3>Leads</h3>
              <p>Track manually entered opportunities before they become booking requests.</p>
            </div>
            <button
              className="button button--primary"
              onClick={() => setShowLeadForm((current) => !current)}
              type="button"
            >
              {showLeadForm ? "Close" : "+ Add Lead"}
            </button>
          </div>

          {showLeadForm ? (
            <ManualLeadPanel
              busy={busyAction?.action === "create"}
              lead={manualLead}
              onChange={setManualLead}
              onCreate={createManualLead}
            />
          ) : null}

          {manualLeads.length === 0 ? (
            <div className="owner-empty">
              <h2>No manual leads.</h2>
              <p>Owner-created opportunities with Lead status will appear here.</p>
            </div>
          ) : null}
          {manualLeads.map((lead) => (
            <ManualLeadCard
              busyAction={busyAction}
              key={lead.leadId}
              lead={lead}
              onUpdate={updateManualLead}
            />
          ))}
        </section>
      ) : null}

      {isOwner && activeTab === "contractors" ? (
        <section className="operations-section" id="operations-panel-contractors" role="tabpanel" aria-labelledby="operations-tab-contractors">
          <div className="operations-section__header">
            <div>
              <h3>Contractors</h3>
              <p>Invite individual contractor accounts and remove access when someone is deactivated.</p>
            </div>
          </div>
          {!contractorDbConfigured ? (
            <div className="owner-empty">
              <h2>Contractor database is not configured.</h2>
              <p>Configure CONTRACTOR_DATABASE_URL before contractor accounts can be created.</p>
            </div>
          ) : (
            <>
              <ContractorInvitePanel
                busy={busyAction?.leadId === "contractor-account"}
                form={contractorForm}
                onChange={setContractorForm}
                onCreate={createContractorAccount}
              />
              {contractorAccounts.length === 0 ? (
                <div className="owner-empty">
                  <h2>No contractor accounts yet.</h2>
                  <p>Owner-invited contractors will appear here after they are created.</p>
                </div>
              ) : null}
              {contractorAccounts.map((contractor) => (
                <ContractorAccountCard
                  busy={busyAction?.leadId === contractor.id}
                  contractor={contractor}
                  key={contractor.id}
                  onDeactivate={deactivateContractorAccount}
                />
              ))}
            </>
          )}
        </section>
      ) : null}

      {isOwner && activeTab === "availability" ? (
        <section className="operations-section" id="operations-panel-availability" role="tabpanel" aria-labelledby="operations-tab-availability">
          <div className="operations-section__header">
            <div>
              <h3>Availability</h3>
              <p>Review regular availability, on-call windows, exceptions, and owner-designated shifts.</p>
            </div>
          </div>
          {!contractorDbConfigured ? (
            <div className="owner-empty">
              <h2>Contractor database is not configured.</h2>
              <p>Configure CONTRACTOR_DATABASE_URL before availability can be reviewed.</p>
            </div>
          ) : (
            <OwnerAvailabilityPanel
              availability={availabilityRows}
              busyId={busyAction?.leadId ?? null}
              contractors={contractorAccounts}
              designatedShift={designatedShift}
              filters={availabilityFilter}
              onCreate={createDesignatedShift}
              onFilter={setAvailabilityFilter}
              onShiftChange={setDesignatedShift}
              onWithdraw={withdrawOwnerAvailability}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}

type ContractorResult = {
  ok: boolean;
  message?: string;
  contractor?: ContractorAccount;
};

type AvailabilityResult = {
  ok: boolean;
  message?: string;
  availability?: ContractorAvailability;
};

type AssignmentResult = {
  ok: boolean;
  message?: string;
  assignments?: ContractorAssignment[];
  candidates?: AssignmentCandidate[];
  travelBufferMinutes?: number;
};

function OwnerAvailabilityPanel({
  availability,
  busyId,
  contractors,
  designatedShift,
  filters,
  onCreate,
  onFilter,
  onShiftChange,
  onWithdraw,
}: {
  availability: ContractorAvailability[];
  busyId: string | null;
  contractors: ContractorAccount[];
  designatedShift: {
    contractorId: string;
    availabilityType: string;
    availabilityDate: string;
    startTime: string;
    endTime: string;
    notes: string;
  };
  filters: { contractorId: string; availabilityType: string };
  onCreate: () => Promise<void>;
  onFilter: (filters: { contractorId: string; availabilityType: string }) => void;
  onShiftChange: (shift: {
    contractorId: string;
    availabilityType: string;
    availabilityDate: string;
    startTime: string;
    endTime: string;
    notes: string;
  }) => void;
  onWithdraw: (availabilityId: string) => Promise<void>;
}) {
  const filtered = availability.filter((row) => {
    if (filters.contractorId && row.contractorId !== filters.contractorId) return false;
    if (filters.availabilityType && row.availabilityType !== filters.availabilityType) return false;
    return true;
  });

  return (
    <>
      <section className="manual-lead-panel availability-panel" aria-label="Create designated shift">
        <div className="field-grid">
          <label className="field">
            <span>Contractor</span>
            <select
              onChange={(event) => onShiftChange({ ...designatedShift, contractorId: event.target.value })}
              value={designatedShift.contractorId}
            >
              <option value="">Choose contractor</option>
              {contractors.map((contractor) => (
                <option key={contractor.id} value={contractor.id}>{contractor.displayName}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input
              min={todayDateValue()}
              onChange={(event) => onShiftChange({ ...designatedShift, availabilityDate: event.target.value })}
              type="date"
              value={designatedShift.availabilityDate}
            />
          </label>
          <label className="field">
            <span>Start</span>
            <input onChange={(event) => onShiftChange({ ...designatedShift, startTime: event.target.value })} type="time" value={designatedShift.startTime} />
          </label>
          <label className="field">
            <span>End</span>
            <input onChange={(event) => onShiftChange({ ...designatedShift, endTime: event.target.value })} type="time" value={designatedShift.endTime} />
          </label>
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea maxLength={500} onChange={(event) => onShiftChange({ ...designatedShift, notes: event.target.value })} value={designatedShift.notes} />
        </label>
        <button
          className="button button--primary"
          disabled={!designatedShift.contractorId || !designatedShift.availabilityDate || busyId === "owner-availability"}
          onClick={onCreate}
          type="button"
        >
          {busyId === "owner-availability" ? "Saving..." : "Add Designated Shift"}
        </button>
      </section>

      <div className="operations-tabs availability-filters" aria-label="Availability filters">
        <label className="field">
          <span>Contractor</span>
          <select onChange={(event) => onFilter({ ...filters, contractorId: event.target.value })} value={filters.contractorId}>
            <option value="">All contractors</option>
            {contractors.map((contractor) => (
              <option key={contractor.id} value={contractor.id}>{contractor.displayName}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select onChange={(event) => onFilter({ ...filters, availabilityType: event.target.value })} value={filters.availabilityType}>
            <option value="">All types</option>
            <option value="REGULAR">Regular</option>
            <option value="ON_CALL">On-call</option>
            <option value="EXCEPTION">Exception</option>
            <option value="DESIGNATED_SHIFT">Designated shift</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="owner-empty">
          <h2>No availability found.</h2>
          <p>Contractor availability and owner-designated shifts will appear here.</p>
        </div>
      ) : (
        <div className="availability-list">
          {filtered.map((row) => (
            <article className="availability-row" key={row.id}>
              <div>
                <p className="eyebrow">{row.contractorName} / {availabilityTypeLabel(row.availabilityType)} / {row.status}</p>
                <h4>{availabilityScheduleLabel(row)}</h4>
                <p>{row.startTime} - {row.endTime} / {row.timezone}</p>
                {row.notes ? <p>{row.notes}</p> : null}
              </div>
              {row.status === "ACTIVE" ? (
                <button className="button button--dark" disabled={Boolean(busyId)} onClick={() => onWithdraw(row.id)} type="button">
                  {busyId === row.id ? "Withdrawing..." : "Withdraw"}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function ContractorInvitePanel({
  busy,
  form,
  onChange,
  onCreate,
}: {
  busy: boolean;
  form: { displayName: string; email: string; temporaryPassword: string };
  onChange: (form: { displayName: string; email: string; temporaryPassword: string }) => void;
  onCreate: () => Promise<void>;
}) {
  return (
    <section className="manual-lead-panel" aria-label="Invite contractor">
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input
            disabled={busy}
            maxLength={120}
            onChange={(event) => onChange({ ...form, displayName: event.target.value })}
            required
            type="text"
            value={form.displayName}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            autoComplete="off"
            disabled={busy}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            required
            type="email"
            value={form.email}
          />
        </label>
        <label className="field">
          <span>Temporary Password</span>
          <input
            autoComplete="new-password"
            disabled={busy}
            minLength={12}
            onChange={(event) => onChange({ ...form, temporaryPassword: event.target.value })}
            required
            type="password"
            value={form.temporaryPassword}
          />
        </label>
      </div>
      <div className="owner-actions owner-actions--compact">
        <button
          className="button button--primary"
          disabled={busy || !form.displayName.trim() || !form.email.trim() || form.temporaryPassword.trim().length < 12}
          onClick={onCreate}
          type="button"
        >
          {busy ? "Creating..." : "Create Contractor Account"}
        </button>
      </div>
    </section>
  );
}

function ContractorAccountCard({
  busy,
  contractor,
  onDeactivate,
}: {
  busy: boolean;
  contractor: ContractorAccount;
  onDeactivate: (contractorId: string) => Promise<void>;
}) {
  const isActive = contractor.status === "ACTIVE";
  return (
    <article className="owner-lead contractor-account-card">
      <div className="owner-lead__header">
        <div>
          <p className="eyebrow">{contractor.status}</p>
          <h2>{contractor.displayName}</h2>
          <p>{contractor.email}</p>
        </div>
        {isActive ? (
          <button
            className="button button--dark"
            disabled={busy}
            onClick={() => onDeactivate(contractor.id)}
            type="button"
          >
            {busy ? "Deactivating..." : "Deactivate"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ManualLeadPanel({
  busy,
  lead,
  onChange,
  onCreate,
}: {
  busy: boolean;
  lead: ManualLeadForm;
  onChange: (lead: ManualLeadForm) => void;
  onCreate: () => Promise<void>;
}) {
  function update<K extends keyof ManualLeadForm>(key: K, value: ManualLeadForm[K]) {
    onChange({ ...lead, [key]: value });
  }

  return (
    <section className="manual-lead-panel" aria-label="Add manual lead">
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input
            disabled={busy}
            maxLength={160}
            onChange={(event) => update("name", event.target.value)}
            required
            type="text"
            value={lead.name}
          />
        </label>
        <label className="field">
          <span>Phone</span>
          <input
            disabled={busy}
            inputMode="tel"
            onChange={(event) => update("phone", event.target.value)}
            type="tel"
            value={lead.phone}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            disabled={busy}
            onChange={(event) => update("email", event.target.value)}
            type="email"
            value={lead.email}
          />
        </label>
        <label className="field">
          <span>Address</span>
          <input
            disabled={busy}
            maxLength={240}
            onChange={(event) => update("streetAddress", event.target.value)}
            type="text"
            value={lead.streetAddress}
          />
        </label>
        <label className="field">
          <span>City</span>
          <input
            disabled={busy}
            maxLength={120}
            onChange={(event) => update("city", event.target.value)}
            type="text"
            value={lead.city}
          />
        </label>
      </div>
      <label className="field">
        <span>Opportunity Info</span>
        <textarea
          disabled={busy}
          maxLength={1400}
          onChange={(event) => update("opportunityInfo", event.target.value)}
          required
          value={lead.opportunityInfo}
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          disabled={busy}
          maxLength={800}
          onChange={(event) => update("notes", event.target.value)}
          value={lead.notes}
        />
      </label>
      <div className="owner-actions owner-actions--compact">
        <button
          className="button button--primary"
          disabled={busy || !lead.name.trim() || !lead.opportunityInfo.trim()}
          onClick={onCreate}
          type="button"
        >
          {busy ? "Creating..." : "Create Lead"}
        </button>
      </div>
    </section>
  );
}

function ManualLeadCard({
  busyAction,
  lead,
  onUpdate,
}: {
  busyAction: BusyAction;
  lead: SheetLead;
  onUpdate: (leadId: string, action: LeadAction, values: Record<string, string>) => Promise<void>;
}) {
  const [approvedAmount, setApprovedAmount] = useState(lead.approvedAmount || "");
  const [declineReason, setDeclineReason] = useState("");
  const isBusy = busyAction !== null;
  const isConvertBusy = busyAction?.leadId === lead.leadId && busyAction.action === "convert";
  const isDeclineBusy = busyAction?.leadId === lead.leadId && busyAction.action === "decline";
  const canTransition = lead.status === MANUAL_LEAD_STATUS;

  return (
    <article className="owner-lead manual-lead-card">
      <LeadHeader lead={lead} />
      <dl className="owner-detail-grid">
        <div><dt>Phone</dt><dd>{lead.phone || "Not provided"}</dd></div>
        <div><dt>Email</dt><dd>{lead.email || "Not provided"}</dd></div>
        <div><dt>Address / City</dt><dd>{[lead.streetAddress, lead.city].filter(Boolean).join(", ") || "Not provided"}</dd></div>
        <div><dt>Opportunity Info</dt><dd>{lead.projectDescription}</dd></div>
        <div><dt>Approved Amount</dt><dd>{lead.approvedAmount || "Not recorded"}</dd></div>
        <div><dt>Created</dt><dd>{lead.createdAt}</dd></div>
        <div><dt>Status</dt><dd>{lead.status}</dd></div>
        <div><dt>Linked Job</dt><dd>{linkedJobLabel(lead)}</dd></div>
        <div><dt>Decision</dt><dd>{lead.decisionTimestamp || "Not recorded"}</dd></div>
        <div><dt>Decline Reason</dt><dd>{lead.declineReason || "None"}</dd></div>
      </dl>
      {canTransition ? (
        <div className="owner-actions operations-actions manual-lead-actions">
          <div className="operations-approval-control">
            <label className="field operations-amount">
              <span>Approved Amount</span>
              <input
                disabled={isBusy}
                inputMode="decimal"
                min="0"
                onChange={(event) => setApprovedAmount(event.target.value)}
                placeholder="0.00"
                step="0.01"
                type="number"
                value={approvedAmount}
              />
            </label>
            <button
              className="button button--primary"
              disabled={isBusy || !approvedAmount.trim()}
              onClick={() => onUpdate(lead.leadId, "convert", { approvedAmount })}
              type="button"
            >
              {isConvertBusy ? "Converting..." : "Convert to Active Job"}
            </button>
          </div>
          <div className="owner-decline-control">
            <label className="field">
              <span>Decline reason</span>
              <input
                disabled={isBusy}
                maxLength={220}
                onChange={(event) => setDeclineReason(event.target.value)}
                placeholder="Optional"
                type="text"
                value={declineReason}
              />
            </label>
            <button
              className="button button--dark"
              disabled={isBusy}
              onClick={() => onUpdate(lead.leadId, "decline", { reason: declineReason })}
              type="button"
            >
              {isDeclineBusy ? "Declining..." : "Decline Lead"}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function linkedJobLabel(lead: SheetLead) {
  return [APPROVED_STATUS, IN_PROGRESS_STATUS, COMPLETED_STATUS].includes(lead.status)
    ? lead.leadId
    : "Not linked";
}

function RequestCard({
  busyAction,
  lead,
  onDecide,
}: {
  busyAction: BusyAction;
  lead: SheetLead;
  onDecide: (leadId: string, action: "approve" | "decline" | "close", values: Record<string, string>) => Promise<void>;
}) {
  const [approvedAmount, setApprovedAmount] = useState(lead.approvedAmount || "");
  const [businessOwner, setBusinessOwner] = useState(lead.businessOwner || "");
  const [declineReason, setDeclineReason] = useState("Requested time unavailable");
  const [closeReason, setCloseReason] = useState("No response");
  const [closeNote, setCloseNote] = useState("");
  const isBusy = busyAction !== null;
  const isApproveBusy = busyAction?.leadId === lead.leadId && busyAction.action === "approve";
  const isDeclineBusy = busyAction?.leadId === lead.leadId && busyAction.action === "decline";
  const isCloseBusy = busyAction?.leadId === lead.leadId && busyAction.action === "close";
  const isFinal = [APPROVED_STATUS, DECLINED_STATUS, CLOSED_STATUS].includes(lead.status);
  const canApprove = lead.status === LEAD_STATUS;

  return (
    <article className="owner-lead">
      <LeadHeader lead={lead} />
      <LeadDetails lead={lead} />

      {lead.status === CONFLICT_STATUS ? (
        <p className="owner-inline-error">
          This requested time is no longer available. Please contact the customer to choose another time.
        </p>
      ) : null}

      {isFinal ? null : (
        <div className="owner-actions operations-actions">
          {canApprove ? (
            <div className="operations-approval-control">
              <label className="field operations-amount">
                <span>Approved Amount</span>
                <input
                  disabled={isBusy}
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => setApprovedAmount(event.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={approvedAmount}
                />
              </label>
              <label className="field operations-amount">
                <span>Owner</span>
                <input
                  disabled={isBusy}
                  maxLength={120}
                  onChange={(event) => setBusinessOwner(event.target.value)}
                  placeholder="Business owner"
                  type="text"
                  value={businessOwner}
                />
              </label>
              <button
                className="button button--primary"
                disabled={isBusy}
                onClick={() => onDecide(lead.leadId, "approve", { approvedAmount, businessOwner })}
                type="button"
              >
                {isApproveBusy ? "Approving..." : "Approve"}
              </button>
            </div>
          ) : null}

          <div className="owner-decline-control">
            <label className="field">
              <span>Decline reason</span>
              <select
                disabled={isBusy}
                onChange={(event) => setDeclineReason(event.target.value)}
                value={declineReason}
              >
                <option>Requested time unavailable</option>
                <option>Outside service area</option>
                <option>Need more information</option>
                <option>Unable to service project</option>
                <option>Other</option>
              </select>
            </label>
            <button
              className="button button--dark"
              disabled={isBusy}
              onClick={() => onDecide(lead.leadId, "decline", { reason: declineReason })}
              type="button"
            >
              {isDeclineBusy ? "Declining..." : "Decline"}
            </button>
          </div>

          <div className="owner-decline-control">
            <label className="field">
              <span>Close reason</span>
              <select
                disabled={isBusy}
                onChange={(event) => setCloseReason(event.target.value)}
                value={closeReason}
              >
                <option>Customer cancelled</option>
                <option>Unable to reschedule</option>
                <option>Duplicate request</option>
                <option>Test record</option>
                <option>No response</option>
                <option>Other</option>
              </select>
            </label>
            <label className="field">
              <span>Close note</span>
              <input
                disabled={isBusy}
                maxLength={220}
                onChange={(event) => setCloseNote(event.target.value)}
                placeholder="Optional"
                type="text"
                value={closeNote}
              />
            </label>
            <button
              className="button button--ghost"
              disabled={isBusy}
              onClick={() => onDecide(lead.leadId, "close", { reason: closeReason, note: closeNote })}
              type="button"
            >
              {isCloseBusy ? "Closing..." : "Close Request"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function JobCard({
  assignments,
  busyAction,
  candidates,
  contractorDbConfigured,
  contractors,
  isOwner,
  lead,
  onCrewUpdate,
  onMutate,
}: {
  assignments: ContractorAssignment[];
  busyAction: BusyAction;
  candidates: AssignmentCandidate[];
  contractorDbConfigured: boolean;
  contractors: ContractorAccount[];
  isOwner: boolean;
  lead: SheetLead;
  onCrewUpdate: (
    lead: SheetLead,
    action: "propose" | "approve" | "reject" | "cancel",
    values: {
      contractorIds?: string[];
      requiredCrewSize?: string;
      travelBufferMinutes?: string;
      travelBufferOverride?: boolean;
      note?: string;
    },
  ) => Promise<void>;
  onMutate: (leadId: string, action: "status" | "complete", values: Record<string, string>) => Promise<void>;
}) {
  const [status, setStatus] = useState(lead.status === IN_PROGRESS_STATUS ? IN_PROGRESS_STATUS : APPROVED_STATUS);
  const [finalAmount, setFinalAmount] = useState(lead.completionFinalAmount || lead.approvedAmount || "");
  const [projectCosts, setProjectCosts] = useState(lead.projectCosts || "");
  const [distance, setDistance] = useState(lead.distance || "");
  const [notes, setNotes] = useState(lead.completionNotes || "");
  const [fallbackOwner, setFallbackOwner] = useState("");
  const hasStoredOwner = Boolean(lead.businessOwner.trim());
  const isBusy = busyAction !== null;
  const isCompleteBusy = busyAction?.leadId === lead.leadId && busyAction.action === "complete";
  const isStatusBusy = busyAction?.leadId === lead.leadId && busyAction.action === "status";
  const completed = lead.status === COMPLETED_STATUS;

  return (
    <article className="owner-lead">
      <LeadHeader lead={lead} />
      <LeadDetails lead={lead} />
      <dl className="owner-status-detail">
        <div><dt>Approved Amount</dt><dd>{lead.approvedAmount || "Not recorded"}</dd></div>
        <div><dt>Owner</dt><dd>{lead.businessOwner || "Not recorded"}</dd></div>
        <div><dt>Calendar Event</dt><dd>{lead.calendarEventId || "Not recorded"}</dd></div>
        <div><dt>Completed At</dt><dd>{lead.completedAt || "Not completed"}</dd></div>
      </dl>

      {completed ? null : (
        <div className="operations-job-controls">
          <div className="owner-decline-control">
            <label className="field">
              <span>Job status</span>
              <select
                disabled={isBusy}
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value={APPROVED_STATUS}>Approved / Scheduled</option>
                <option value={IN_PROGRESS_STATUS}>In Progress</option>
              </select>
            </label>
            <button
              className="button button--ghost"
              disabled={isBusy}
              onClick={() => onMutate(lead.leadId, "status", { status })}
              type="button"
            >
              {isStatusBusy ? "Updating..." : "Update Status"}
            </button>
          </div>

          <div className="operations-closeout">
            <label className="field">
              <span>Final Amount</span>
              <input disabled={isBusy} inputMode="decimal" min="0" onChange={(event) => setFinalAmount(event.target.value)} step="0.01" type="number" value={finalAmount} />
            </label>
            <label className="field">
              <span>Project Costs</span>
              <input disabled={isBusy} inputMode="decimal" min="0" onChange={(event) => setProjectCosts(event.target.value)} step="0.01" type="number" value={projectCosts} />
            </label>
            <label className="field">
              <span>Distance</span>
              <input disabled={isBusy} inputMode="decimal" min="0" onChange={(event) => setDistance(event.target.value)} step="0.1" type="number" value={distance} />
            </label>
            {hasStoredOwner ? (
              <div className="operations-owner-context">
                <span>Owner</span>
                <strong>{lead.businessOwner}</strong>
              </div>
            ) : (
              <label className="field">
                <span>Owner</span>
                <input
                  disabled={isBusy}
                  maxLength={120}
                  onChange={(event) => setFallbackOwner(event.target.value)}
                  placeholder="Business owner"
                  required
                  type="text"
                  value={fallbackOwner}
                />
              </label>
            )}
            <label className="field operations-notes">
              <span>Completion Notes</span>
              <textarea disabled={isBusy} onChange={(event) => setNotes(event.target.value)} value={notes} />
            </label>
            <button
              className="button button--primary"
              disabled={isBusy}
              onClick={() => onMutate(lead.leadId, "complete", { finalAmount, projectCosts, distance, notes, owner: hasStoredOwner ? "" : fallbackOwner })}
              type="button"
            >
              {isCompleteBusy ? "Completing..." : "Complete Job"}
            </button>
          </div>
        </div>
      )}

      {isOwner ? (
        <CrewAssignmentPanel
          assignments={assignments}
          busyAction={busyAction}
          contractorDbConfigured={contractorDbConfigured}
          contractors={contractors}
          candidates={candidates}
          lead={lead}
          onCrewUpdate={onCrewUpdate}
        />
      ) : null}
    </article>
  );
}

function CrewAssignmentPanel({
  assignments,
  busyAction,
  candidates,
  contractorDbConfigured,
  contractors,
  lead,
  onCrewUpdate,
}: {
  assignments: ContractorAssignment[];
  busyAction: BusyAction;
  candidates: AssignmentCandidate[];
  contractorDbConfigured: boolean;
  contractors: ContractorAccount[];
  lead: SheetLead;
  onCrewUpdate: (
    lead: SheetLead,
    action: "propose" | "approve" | "reject" | "cancel",
    values: {
      contractorIds?: string[];
      requiredCrewSize?: string;
      travelBufferMinutes?: string;
      travelBufferOverride?: boolean;
      note?: string;
    },
  ) => Promise<void>;
}) {
  const [requiredCrewSize, setRequiredCrewSize] = useState(String(assignments[0]?.requiredCrewSize || 1));
  const [travelBufferMinutes, setTravelBufferMinutes] = useState(String(assignments[0]?.travelBufferMinutes || 30));
  const [travelBufferOverride, setTravelBufferOverride] = useState(Boolean(assignments[0]?.travelBufferOverride));
  const initialSchedule = initialAssignmentSchedule(lead, assignments);
  const [assignmentDate, setAssignmentDate] = useState(initialSchedule.date);
  const [assignmentStartTime, setAssignmentStartTime] = useState(initialSchedule.startTime);
  const [assignmentEndTime, setAssignmentEndTime] = useState(initialSchedule.endTime);
  const [availabilityNeedsRecheck, setAvailabilityNeedsRecheck] = useState(false);
  const [selectedContractors, setSelectedContractors] = useState(
    assignments
      .filter((assignment) => [ASSIGNMENT_STATUS_PROPOSED, ASSIGNMENT_STATUS_APPROVED, ASSIGNMENT_STATUS_CONFLICT_REVIEW].includes(assignment.status))
      .filter((assignment) => contractors.some((contractor) => contractor.id === assignment.contractorId && contractor.status === "ACTIVE"))
      .map((assignment) => assignment.contractorId),
  );
  const [note, setNote] = useState("");
  const isBusy = busyAction !== null;
  const proposed = assignments.filter((assignment) => assignment.status === ASSIGNMENT_STATUS_PROPOSED);
  const approved = assignments.filter((assignment) =>
    [ASSIGNMENT_STATUS_APPROVED, ASSIGNMENT_STATUS_CONFLICT_REVIEW].includes(assignment.status),
  );
  const inactive = assignments.filter((assignment) =>
    [ASSIGNMENT_STATUS_REJECTED, ASSIGNMENT_STATUS_CANCELED].includes(assignment.status),
  );
  const selectedCount = selectedContractors.length;
  const crewShort = selectedCount < Number(requiredCrewSize || 1);
  const scheduleMissing = !assignmentDate || !assignmentStartTime || !assignmentEndTime;
  const assignableContractors = contractors.filter((contractor) => contractor.status === "ACTIVE");
  const selectedCandidateIssues = selectedContractors
    .map((contractorId) => {
      const contractor = assignableContractors.find((account) => account.id === contractorId);
      const candidate = candidates.find((item) => item.contractorId === contractorId);
      if (!candidate?.conflict) return "";
      return `${contractor?.displayName ?? candidate.contractorName}: ${candidate.conflictReason || "Not available for this job window."}`;
    })
    .filter(Boolean);
  const selectedHasConflict = !availabilityNeedsRecheck && selectedCandidateIssues.length > 0;
  const crewValues = {
    assignmentDate,
    assignmentStartTime,
    assignmentEndTime,
    contractorIds: selectedContractors,
    requiredCrewSize,
    travelBufferMinutes,
    travelBufferOverride,
    note,
  };

  function toggleContractor(contractorId: string) {
    setSelectedContractors((current) =>
      current.includes(contractorId)
        ? current.filter((id) => id !== contractorId)
        : [...current, contractorId],
    );
  }

  async function handleCrewUpdate(action: "propose" | "approve") {
    await onCrewUpdate(lead, action, crewValues);
    setAvailabilityNeedsRecheck(false);
  }

  if (!contractorDbConfigured) {
    return (
      <section className="manual-lead-panel assignment-panel">
        <h3>Crew Assignments</h3>
        <p className="portal-empty-copy">Configure CONTRACTOR_DATABASE_URL before crew proposals can be saved.</p>
      </section>
    );
  }

  return (
    <section className="manual-lead-panel assignment-panel" aria-label={`Crew assignments for ${lead.leadId}`}>
      <div className="operations-section__header">
        <div>
          <h3>Crew Assignments</h3>
          <p>Set the job schedule and crew, then save a proposal or approve it after availability is rechecked.</p>
        </div>
      </div>
      <dl className="owner-status-detail">
        <div><dt>Required Crew</dt><dd>{requiredCrewSize}</dd></div>
        <div><dt>Selected</dt><dd>{selectedCount}</dd></div>
        <div><dt>Travel Buffer</dt><dd>{travelBufferMinutes} minutes{travelBufferOverride ? " / override" : ""}</dd></div>
        <div><dt>Schedule</dt><dd>{assignmentWindowLabel(assignmentDate, assignmentStartTime, assignmentEndTime)}</dd></div>
      </dl>
      {scheduleMissing ? (
        <p className="owner-inline-error">Set a job date, start time, and end time before saving or approving a crew.</p>
      ) : null}
      {crewShort ? (
        <p className="owner-inline-error">Selected crew is below the required crew size.</p>
      ) : null}
      {selectedHasConflict ? (
        <div className="owner-inline-error" role="alert">
          <p>This crew has a cached availability warning. Save or approve to recheck against the current schedule.</p>
          <ul>
            {selectedCandidateIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      ) : null}
      {availabilityNeedsRecheck ? (
        <p className="portal-empty-copy">Availability will be rechecked against the current schedule when you save or approve.</p>
      ) : null}
      <div className="field-grid">
        <label className="field">
          <span>Job date</span>
          <input disabled={isBusy} min={todayDateValue()} onChange={(event) => {
            setAssignmentDate(event.target.value);
            setAvailabilityNeedsRecheck(true);
          }} type="date" value={assignmentDate} />
        </label>
        <label className="field">
          <span>Start time</span>
          <input disabled={isBusy} onChange={(event) => {
            setAssignmentStartTime(event.target.value);
            setAvailabilityNeedsRecheck(true);
          }} type="time" value={assignmentStartTime} />
        </label>
        <label className="field">
          <span>End time</span>
          <input disabled={isBusy} onChange={(event) => {
            setAssignmentEndTime(event.target.value);
            setAvailabilityNeedsRecheck(true);
          }} type="time" value={assignmentEndTime} />
        </label>
        <label className="field">
          <span>Required crew size</span>
          <input disabled={isBusy} min="1" onChange={(event) => setRequiredCrewSize(event.target.value)} type="number" value={requiredCrewSize} />
        </label>
        <label className="field">
          <span>Travel buffer minutes</span>
          <input disabled={isBusy} min="0" onChange={(event) => {
            setTravelBufferMinutes(event.target.value);
            setTravelBufferOverride(true);
            setAvailabilityNeedsRecheck(true);
          }} type="number" value={travelBufferMinutes} />
        </label>
      </div>
      <label className="field">
        <span>Proposal note</span>
        <textarea disabled={isBusy} maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} />
      </label>
      <div className="availability-list">
        {assignableContractors.length === 0 ? (
          <div className="owner-empty">
            <h2>No active contractor accounts.</h2>
            <p>Activate contractor accounts before assigning crews.</p>
          </div>
        ) : assignableContractors.map((contractor) => {
          const candidate = candidates.find((item) => item.contractorId === contractor.id);
          return (
          <label className="availability-row assignment-choice" key={contractor.id}>
            <input
              checked={selectedContractors.includes(contractor.id)}
              disabled={isBusy || contractor.status !== "ACTIVE"}
              onChange={() => toggleContractor(contractor.id)}
              type="checkbox"
            />
            <span>
              <strong>{contractor.displayName}</strong>
              <small>{candidateLabel(candidate, contractor.status, availabilityNeedsRecheck)}</small>
              {!availabilityNeedsRecheck && candidate?.conflictReason ? <small>{candidate.conflictReason}</small> : null}
            </span>
          </label>
          );
        })}
      </div>
      <div className="owner-actions owner-actions--compact">
        <button
          className="button button--ghost"
          disabled={isBusy || scheduleMissing || selectedContractors.length === 0}
          onClick={() => handleCrewUpdate("propose")}
          type="button"
        >
          {busyAction?.leadId === lead.leadId && busyAction.action === "crew-propose" ? "Saving..." : "Save Proposal"}
        </button>
        <button
          className="button button--primary"
          disabled={isBusy || scheduleMissing || selectedContractors.length === 0 || crewShort}
          onClick={() => handleCrewUpdate("approve")}
          type="button"
        >
          {busyAction?.leadId === lead.leadId && busyAction.action === "crew-approve" ? "Approving..." : "Approve Crew"}
        </button>
        <button
          className="button button--dark"
          disabled={isBusy || proposed.length === 0}
          onClick={() => onCrewUpdate(lead, "reject", {})}
          type="button"
        >
          Reject Proposal
        </button>
        <button
          className="button button--ghost"
          disabled={isBusy || approved.length === 0}
          onClick={() => onCrewUpdate(lead, "cancel", {})}
          type="button"
        >
          Cancel Approved Crew
        </button>
      </div>
      <AssignmentStatusList title="Current Crew" assignments={[...approved, ...proposed]} />
      <AssignmentStatusList title="Past Crew Decisions" assignments={inactive} />
    </section>
  );
}

function AssignmentStatusList({
  assignments,
  title,
}: {
  assignments: ContractorAssignment[];
  title: string;
}) {
  if (assignments.length === 0) return null;
  return (
    <div className="availability-list assignment-status-list">
      <h4>{title}</h4>
      {assignments.map((assignment) => (
        <article className="availability-row" key={assignment.assignmentId}>
          <div>
            <p className="eyebrow">{assignment.status}</p>
            <h4>{assignment.contractorName}</h4>
            <p>{assignment.serviceTypes || "Service details hidden"}</p>
            {assignment.conflictReason ? <p className="owner-inline-error">{assignment.conflictReason}</p> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function LeadHeader({ lead }: { lead: SheetLead }) {
  return (
    <div className="owner-lead__header">
      <div>
        <p className="eyebrow">{lead.status}</p>
        <h2>{lead.name}</h2>
        <p>{lead.leadId}</p>
      </div>
    </div>
  );
}

function LeadDetails({ lead }: { lead: SheetLead }) {
  return (
    <dl className="owner-detail-grid">
      <div><dt>Phone</dt><dd>{lead.phone}</dd></div>
      <div><dt>Email</dt><dd>{lead.email}</dd></div>
      <div><dt>Address</dt><dd>{lead.streetAddress}, {lead.city}, {lead.state} {lead.zip}</dd></div>
      <div><dt>Service Type(s)</dt><dd>{lead.services}</dd></div>
      <div><dt>Appointment Type</dt><dd>{lead.appointmentType}</dd></div>
      <div><dt>Requested Time</dt><dd>{lead.requestedDate} / {lead.requestedTime}</dd></div>
      <div><dt>Photos</dt><dd><LeadPhotos lead={lead} /></dd></div>
      <div><dt>Description</dt><dd>{lead.projectDescription}</dd></div>
    </dl>
  );
}

function LeadPhotos({ lead }: { lead: SheetLead }) {
  if (lead.photos.length === 0) return "None provided";
  return (
    <div className="operations-photo-list">
      {lead.photos.map((photo, index) => (
        <a
          className="operations-photo-link"
          href={`/api/operations/photos?leadId=${encodeURIComponent(lead.leadId)}&photoId=${encodeURIComponent(photo.id)}`}
          key={`${photo.id}-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          {photo.name || `Photo ${index + 1}`}
        </a>
      ))}
    </div>
  );
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as OwnerDecisionResult | OperationsResult;
  } catch {
    return null;
  }
}

function responseLead(payload: Awaited<ReturnType<typeof readJson>>) {
  if (!payload) return null;
  if ("details" in payload && payload.details?.lead) return payload.details.lead;
  if ("lead" in payload && payload.lead) return payload.lead;
  return null;
}

function upsertAvailability(
  current: ContractorAvailability[],
  updated: ContractorAvailability,
) {
  const exists = current.some((row) => row.id === updated.id);
  if (exists) return current.map((row) => row.id === updated.id ? updated : row);
  return [updated, ...current];
}

function replaceLeadAssignments(
  current: ContractorAssignment[],
  leadId: string,
  updated: ContractorAssignment[],
) {
  return [
    ...updated,
    ...current.filter((assignment) => assignment.leadId !== leadId),
  ];
}

function crewActionSuccess(action: "propose" | "approve" | "reject" | "cancel") {
  if (action === "approve") return "Crew assignment approved.";
  if (action === "reject") return "Crew proposal rejected.";
  if (action === "cancel") return "Crew assignment canceled.";
  return "Crew proposal saved.";
}

function assignmentWindowLabel(date: string, startTime: string, endTime: string) {
  if (!date || !startTime || !endTime) return "Date not set / Time not set";
  return `${date} / ${formatTimeInput(startTime)}-${formatTimeInput(endTime)}`;
}

function initialAssignmentSchedule(lead: SheetLead, assignments: ContractorAssignment[]) {
  const activeAssignment = assignments.find((assignment) =>
    [ASSIGNMENT_STATUS_PROPOSED, ASSIGNMENT_STATUS_APPROVED, ASSIGNMENT_STATUS_CONFLICT_REVIEW].includes(assignment.status),
  ) ?? assignments[0];
  if (activeAssignment?.scheduledStart && activeAssignment?.scheduledEnd) {
    return {
      date: isoToLocalDateInput(activeAssignment.scheduledStart),
      startTime: isoToLocalTimeInput(activeAssignment.scheduledStart),
      endTime: isoToLocalTimeInput(activeAssignment.scheduledEnd),
    };
  }

  const date = lead.confirmedDate || lead.requestedDate || "";
  const startTime = timeLabelToInputValue(lead.confirmedTime || lead.requestedTime);
  return {
    date,
    startTime,
    endTime: startTime ? addMinutesToTimeInput(startTime, 120) : "",
  };
}

function timeLabelToInputValue(label: string) {
  const match = label.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToTimeInput(time: string, minutesToAdd: number) {
  const [hour, minute] = time.split(":").map(Number);
  if (![hour, minute].every(Number.isFinite)) return "";
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute + minutesToAdd));
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function isoToLocalDateInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).format(date);
}

function isoToLocalTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.hour}:${map.minute}`;
}

function formatTimeInput(time: string) {
  const [hourValue, minute] = time.split(":").map(Number);
  if (![hourValue, minute].every(Number.isFinite)) return time;
  const hour = hourValue % 12 || 12;
  const meridiem = hourValue >= 12 ? "PM" : "AM";
  return `${hour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function candidateLabel(candidate: AssignmentCandidate | undefined, accountStatus: string, availabilityNeedsRecheck = false) {
  if (accountStatus !== "ACTIVE") return accountStatus;
  if (availabilityNeedsRecheck) return "Recheck needed";
  if (!candidate) return "Availability not evaluated";
  if (candidate.conflict) return "Conflict";
  if (candidate.onCall) return "On-call available";
  if (candidate.availabilityType === "DESIGNATED_SHIFT") return "Designated shift";
  if (candidate.availabilityType === "EXCEPTION") return "Date-specific availability";
  if (candidate.availabilityType === "REGULAR") return "Regular availability";
  return "No matching availability";
}

function todayDateValue() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).format(new Date());
}

function friendlyError(payload: Awaited<ReturnType<typeof readJson>>) {
  const lead = responseLead(payload);
  const message = payload && "message" in payload ? payload.message : "";
  if (lead?.status === CONFLICT_STATUS || message === "Requested time is no longer available.") {
    return "This requested time is no longer available. Please contact the customer to choose another time.";
  }
  return message || "This update could not be completed. Please try again.";
}

function decisionSuccessMessage(action: "approve" | "decline" | "close") {
  if (action === "approve") return "Appointment approved and added to Google Calendar.";
  if (action === "close") return "Request closed.";
  return "Request declined.";
}
