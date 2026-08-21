"use client";

import { useState } from "react";
import {
  APPROVED_STATUS,
  CONFLICT_STATUS,
  COMPLETED_STATUS,
  DECLINED_STATUS,
  IN_PROGRESS_STATUS,
} from "../lib/booking/config";
import { ROLE_OWNER, type OperationsUser } from "../lib/booking/ownerAuth";
import type { OwnerDecisionResult, SheetLead } from "../lib/booking/types";

type OperationsPortalClientProps = {
  activeJobs: SheetLead[];
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

type OperationsResult = {
  ok: boolean;
  message?: string;
  lead?: SheetLead;
  details?: { lead?: SheetLead };
};

export function OperationsPortalClient({
  activeJobs,
  requests,
  user,
}: OperationsPortalClientProps) {
  const [requestLeads, setRequestLeads] = useState(requests);
  const [jobLeads, setJobLeads] = useState(activeJobs);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const isOwner = user.role === ROLE_OWNER;

  function upsertLead(updatedLead: SheetLead) {
    setRequestLeads((current) =>
      current.map((lead) => (lead.leadId === updatedLead.leadId ? updatedLead : lead)),
    );
    setJobLeads((current) => {
      const isActive = [APPROVED_STATUS, IN_PROGRESS_STATUS].includes(updatedLead.status);
      const exists = current.some((lead) => lead.leadId === updatedLead.leadId);
      if (!isActive) {
        return current.map((lead) => (lead.leadId === updatedLead.leadId ? updatedLead : lead));
      }
      if (exists) {
        return current.map((lead) => (lead.leadId === updatedLead.leadId ? updatedLead : lead));
      }
      return [updatedLead, ...current];
    });
  }

  async function decideLead(
    leadId: string,
    action: "approve" | "decline",
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
        message:
          action === "approve"
            ? "Appointment approved and added to Google Calendar."
            : "Request declined.",
      });
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

      {isOwner ? (
        <section className="operations-section">
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

      <section className="operations-section">
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
            key={lead.leadId}
            lead={lead}
            onMutate={mutateJob}
          />
        ))}
      </section>
    </div>
  );
}

function RequestCard({
  busyAction,
  lead,
  onDecide,
}: {
  busyAction: BusyAction;
  lead: SheetLead;
  onDecide: (leadId: string, action: "approve" | "decline", values: Record<string, string>) => Promise<void>;
}) {
  const [approvedAmount, setApprovedAmount] = useState(lead.approvedAmount || "");
  const [declineReason, setDeclineReason] = useState("Requested time unavailable");
  const isBusy = busyAction !== null;
  const isApproveBusy = busyAction?.leadId === lead.leadId && busyAction.action === "approve";
  const isDeclineBusy = busyAction?.leadId === lead.leadId && busyAction.action === "decline";
  const isFinal = [APPROVED_STATUS, DECLINED_STATUS, CONFLICT_STATUS].includes(lead.status);

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
            disabled={isBusy}
            onClick={() => onDecide(lead.leadId, "approve", { approvedAmount })}
            type="button"
          >
            {isApproveBusy ? "Approving..." : "Approve"}
          </button>

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
        </div>
      )}
    </article>
  );
}

function JobCard({
  busyAction,
  lead,
  onMutate,
}: {
  busyAction: BusyAction;
  lead: SheetLead;
  onMutate: (leadId: string, action: "status" | "complete", values: Record<string, string>) => Promise<void>;
}) {
  const [status, setStatus] = useState(lead.status === IN_PROGRESS_STATUS ? IN_PROGRESS_STATUS : APPROVED_STATUS);
  const [finalAmount, setFinalAmount] = useState(lead.completionFinalAmount || lead.approvedAmount || "");
  const [projectCosts, setProjectCosts] = useState(lead.projectCosts || "");
  const [distance, setDistance] = useState(lead.distance || "");
  const [notes, setNotes] = useState(lead.completionNotes || "");
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
            <label className="field operations-notes">
              <span>Completion Notes</span>
              <textarea disabled={isBusy} onChange={(event) => setNotes(event.target.value)} value={notes} />
            </label>
            <button
              className="button button--primary"
              disabled={isBusy}
              onClick={() => onMutate(lead.leadId, "complete", { finalAmount, projectCosts, distance, notes })}
              type="button"
            >
              {isCompleteBusy ? "Completing..." : "Complete Job"}
            </button>
          </div>
        </div>
      )}
    </article>
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
      <div><dt>Photos</dt><dd>{lead.photoReferences || "None provided"}</dd></div>
      <div><dt>Description</dt><dd>{lead.projectDescription}</dd></div>
    </dl>
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
