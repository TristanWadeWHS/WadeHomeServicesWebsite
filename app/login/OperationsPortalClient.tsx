"use client";

import { type KeyboardEvent, useState } from "react";
import {
  APPOINTMENT_TYPES,
  APPROVED_STATUS,
  CLOSED_STATUS,
  CONFLICT_STATUS,
  COMPLETED_STATUS,
  DECLINED_STATUS,
  IN_PROGRESS_STATUS,
  LEAD_STATUS,
  manualLeadBucket,
  MANUAL_LEAD_SOURCE,
  MANUAL_LEAD_STATUS,
  SERVICE_OPTIONS,
} from "../lib/booking/config";
import { ROLE_OWNER, type OperationsUser } from "../lib/booking/ownerAuth";
import type { OwnerDecisionResult, SheetLead } from "../lib/booking/types";

type OperationsPortalClientProps = {
  activeJobs: SheetLead[];
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
type LeadAction = "convert" | "decline";
type LeadSubtab = "active" | "completed" | "declined";
type JobAction = "status" | "complete" | "cancel" | "edit";
type JobEditField =
  | "name"
  | "phone"
  | "email"
  | "streetAddress"
  | "city"
  | "state"
  | "zip"
  | "accessNotes"
  | "services"
  | "appointmentType"
  | "projectDescription"
  | "businessOwner"
  | "approvedAmount"
  | "internalNotes";

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
  const [leadSubtab, setLeadSubtab] = useState<LeadSubtab>("active");
  const [manualLead, setManualLead] = useState<ManualLeadForm>(emptyManualLead);
  const isOwner = user.role === ROLE_OWNER;
  const [activeTab, setActiveTab] = useState<PortalTab>(isOwner ? "requests" : "active");
  const availableTabs: PortalTab[] = isOwner ? ["requests", "active", "leads"] : ["active"];
  const activeManualLeads = manualLeads.filter((lead) => manualLeadBucket(lead.status) === "active");
  const completedManualLeads = manualLeads.filter((lead) => manualLeadBucket(lead.status) === "completed");
  const declinedManualLeads = manualLeads.filter((lead) => manualLeadBucket(lead.status) === "declined");
  const visibleManualLeads =
    leadSubtab === "active"
      ? activeManualLeads
      : leadSubtab === "completed"
        ? completedManualLeads
        : declinedManualLeads;

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

  function handleLeadSubtabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs: LeadSubtab[] = ["active", "completed", "declined"];
    const currentIndex = tabs.indexOf(leadSubtab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    setLeadSubtab(tabs[nextIndex]);
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
    action: JobAction,
    values: Record<string, string>,
  ): Promise<boolean> {
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
        return false;
      }

      setNotice({
        tone: "success",
        message:
          action === "complete"
            ? "Job completed and transferred."
            : action === "cancel"
              ? "Job cancelled."
              : action === "edit"
                ? "Job details updated."
                : "Job status updated.",
      });
      return true;
    } catch {
      setNotice({ tone: "error", message: "This job could not be updated. Please try again." });
      return false;
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
            busyAction={busyAction}
            isOwner={isOwner}
            key={lead.leadId}
            lead={lead}
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

          <div className="operations-subtabs" role="tablist" aria-label="Lead status">
            <button
              aria-controls="operations-leads-list"
              aria-selected={leadSubtab === "active"}
              className="operations-subtab"
              id="operations-leads-tab-active"
              onKeyDown={handleLeadSubtabKeyDown}
              onClick={() => setLeadSubtab("active")}
              role="tab"
              type="button"
            >
              Active Leads ({activeManualLeads.length})
            </button>
            <button
              aria-controls="operations-leads-list"
              aria-selected={leadSubtab === "completed"}
              className="operations-subtab"
              id="operations-leads-tab-completed"
              onKeyDown={handleLeadSubtabKeyDown}
              onClick={() => setLeadSubtab("completed")}
              role="tab"
              type="button"
            >
              Completed Leads ({completedManualLeads.length})
            </button>
            <button
              aria-controls="operations-leads-list"
              aria-selected={leadSubtab === "declined"}
              className="operations-subtab"
              id="operations-leads-tab-declined"
              onKeyDown={handleLeadSubtabKeyDown}
              onClick={() => setLeadSubtab("declined")}
              role="tab"
              type="button"
            >
              Declined Leads ({declinedManualLeads.length})
            </button>
          </div>

          <div
            aria-labelledby={`operations-leads-tab-${leadSubtab}`}
            id="operations-leads-list"
            role="tabpanel"
          >
            {visibleManualLeads.length === 0 ? (
              <div className="owner-empty">
                <h2>No {leadSubtab} leads.</h2>
                <p>Leads will appear here when they reach this stage.</p>
              </div>
            ) : null}
            {visibleManualLeads.map((lead) => (
              <ManualLeadCard
                busyAction={busyAction}
                key={lead.leadId}
                lead={lead}
                onUpdate={updateManualLead}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
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
  busyAction,
  isOwner,
  lead,
  onMutate,
}: {
  busyAction: BusyAction;
  isOwner: boolean;
  lead: SheetLead;
  onMutate: (leadId: string, action: JobAction, values: Record<string, string>) => Promise<boolean>;
}) {
  const [status, setStatus] = useState(lead.status === IN_PROGRESS_STATUS ? IN_PROGRESS_STATUS : APPROVED_STATUS);
  const [finalAmount, setFinalAmount] = useState(lead.completionFinalAmount || lead.approvedAmount || "");
  const [projectCosts, setProjectCosts] = useState(lead.projectCosts || "");
  const [distance, setDistance] = useState(lead.distance || "");
  const [notes, setNotes] = useState(lead.completionNotes || "");
  const [fallbackOwner, setFallbackOwner] = useState("");
  const [showCancellation, setShowCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationConfirmed, setCancellationConfirmed] = useState(false);
  const hasStoredOwner = Boolean(lead.businessOwner.trim());
  const isBusy = busyAction !== null;
  const isCompleteBusy = busyAction?.leadId === lead.leadId && busyAction.action === "complete";
  const isStatusBusy = busyAction?.leadId === lead.leadId && busyAction.action === "status";
  const isCancelBusy = busyAction?.leadId === lead.leadId && busyAction.action === "cancel";
  const completed = lead.status === COMPLETED_STATUS;

  return (
    <article className="owner-lead">
      <LeadHeader lead={lead} />
      <JobEditableDetails
        busyAction={busyAction}
        isOwner={isOwner}
        lead={lead}
        onMutate={onMutate}
      />
      <dl className="owner-status-detail">
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

          {isOwner ? (
            <div className="operations-cancel-job">
              {!showCancellation ? (
                <button
                  className="button button--danger"
                  disabled={isBusy}
                  onClick={() => setShowCancellation(true)}
                  type="button"
                >
                  Cancel Job
                </button>
              ) : (
                <div className="operations-cancel-panel">
                  <label className="field">
                    <span>Cancellation reason</span>
                    <textarea
                      disabled={isBusy}
                      maxLength={300}
                      onChange={(event) => setCancellationReason(event.target.value)}
                      required
                      value={cancellationReason}
                    />
                  </label>
                  <label className="operations-confirm-cancel">
                    <input
                      checked={cancellationConfirmed}
                      disabled={isBusy}
                      onChange={(event) => setCancellationConfirmed(event.target.checked)}
                      type="checkbox"
                    />
                    <span>I confirm this job should be cancelled.</span>
                  </label>
                  <div className="owner-actions owner-actions--compact">
                    <button
                      className="button button--danger"
                      disabled={isBusy || !cancellationReason.trim() || !cancellationConfirmed}
                      onClick={() => onMutate(lead.leadId, "cancel", { reason: cancellationReason })}
                      type="button"
                    >
                      {isCancelBusy ? "Cancelling..." : "Confirm Cancellation"}
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={isBusy}
                      onClick={() => {
                        setShowCancellation(false);
                        setCancellationConfirmed(false);
                      }}
                      type="button"
                    >
                      Keep Job
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

function JobEditableDetails({
  busyAction,
  isOwner,
  lead,
  onMutate,
}: {
  busyAction: BusyAction;
  isOwner: boolean;
  lead: SheetLead;
  onMutate: (leadId: string, action: JobAction, values: Record<string, string>) => Promise<boolean>;
}) {
  const fields: Array<{
    field: JobEditField;
    label: string;
    value: string;
    type?: "email" | "number" | "tel" | "text";
    multiline?: boolean;
    options?: readonly string[];
    multiple?: boolean;
  }> = [
    { field: "name", label: "Name", value: lead.name },
    { field: "phone", label: "Phone", value: lead.phone, type: "tel" },
    { field: "email", label: "Email", value: lead.email, type: "email" },
    { field: "streetAddress", label: "Street Address", value: lead.streetAddress },
    { field: "city", label: "City", value: lead.city },
    { field: "state", label: "State", value: lead.state },
    { field: "zip", label: "ZIP Code", value: lead.zip },
    { field: "accessNotes", label: "Unit / Gate / Access Notes", value: lead.accessNotes, multiline: true },
    { field: "services", label: "Service Type(s)", value: lead.services, options: SERVICE_OPTIONS, multiple: true },
    { field: "appointmentType", label: "Appointment Type", value: lead.appointmentType, options: APPOINTMENT_TYPES },
    { field: "projectDescription", label: "Project Description", value: lead.projectDescription, multiline: true },
    { field: "businessOwner", label: "Owner", value: lead.businessOwner },
    { field: "approvedAmount", label: "Approved Amount", value: lead.approvedAmount, type: "number" },
    { field: "internalNotes", label: "Operational Notes", value: lead.internalNotes, multiline: true },
  ];

  return (
    <dl className="owner-detail-grid operations-editable-grid">
      {fields.filter((item) => isOwner || item.field !== "internalNotes").map((item) => (
        <EditableJobField
          {...item}
          busy={busyAction !== null}
          canEdit={isOwner}
          key={item.field}
          onSave={async (value) =>
            onMutate(lead.leadId, "edit", { field: item.field, value })
          }
        />
      ))}
      <div>
        <dt>Requested Time</dt>
        <dd>{lead.requestedDate} / {lead.requestedTime}</dd>
      </div>
      <div>
        <dt>Photos</dt>
        <dd><LeadPhotos lead={lead} /></dd>
      </div>
    </dl>
  );
}

function EditableJobField({
  busy,
  canEdit,
  field,
  label,
  multiline = false,
  multiple = false,
  onSave,
  options,
  type = "text",
  value,
}: {
  busy: boolean;
  canEdit: boolean;
  field: JobEditField;
  label: string;
  multiline?: boolean;
  multiple?: boolean;
  onSave: (value: string) => Promise<boolean>;
  options?: readonly string[];
  type?: "email" | "number" | "tel" | "text";
  value: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const selectedOptions = new Set(draft.split(",").map((item) => item.trim()).filter(Boolean));

  async function save() {
    if (await onSave(draft)) setEditing(false);
  }

  return (
    <div className={`operations-editable-field operations-editable-field--${field}`}>
      <dt>
        <span>{label}</span>
        {canEdit && !editing ? (
          <button
            aria-label={`Edit ${label}`}
            className="operations-edit-button"
            disabled={busy}
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            title={`Edit ${label}`}
            type="button"
          >
            &#9998;
          </button>
        ) : null}
      </dt>
      <dd>
        {editing ? (
          <div className="operations-inline-editor">
            {options && multiple ? (
              <div className="operations-inline-options">
                {options.map((option) => (
                  <label key={option}>
                    <input
                      checked={selectedOptions.has(option)}
                      disabled={busy}
                      onChange={(event) => {
                        const next = new Set(selectedOptions);
                        if (event.target.checked) next.add(option);
                        else next.delete(option);
                        setDraft(options.filter((item) => next.has(item)).join(", "));
                      }}
                      type="checkbox"
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            ) : options ? (
              <select disabled={busy} onChange={(event) => setDraft(event.target.value)} value={draft}>
                {options.map((option) => <option key={option}>{option}</option>)}
              </select>
            ) : multiline ? (
              <textarea disabled={busy} onChange={(event) => setDraft(event.target.value)} value={draft} />
            ) : (
              <input
                disabled={busy}
                min={type === "number" ? "0" : undefined}
                onChange={(event) => setDraft(event.target.value)}
                step={type === "number" ? "0.01" : undefined}
                type={type}
                value={draft}
              />
            )}
            <div className="owner-actions owner-actions--compact">
              <button className="button button--primary" disabled={busy} onClick={save} type="button">
                {busy ? "Saving..." : "Save"}
              </button>
              <button className="button button--ghost" disabled={busy} onClick={() => setEditing(false)} type="button">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          value || "Not provided"
        )}
      </dd>
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
