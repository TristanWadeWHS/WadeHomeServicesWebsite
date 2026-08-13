"use client";

import { useState } from "react";
import {
  APPROVED_STATUS,
  CONFLICT_STATUS,
  DECLINED_STATUS,
} from "../lib/booking/config";
import type { OwnerDecisionResult, SheetLead } from "../lib/booking/types";

type OwnerApprovalsClientProps = {
  initialLeads: SheetLead[];
};

type DecisionAction = "approve" | "decline";
type Notice = {
  tone: "success" | "error";
  message: string;
};
type BusyAction = {
  leadId: string;
  action: DecisionAction;
} | null;

const finalStatuses = new Set([APPROVED_STATUS, DECLINED_STATUS, CONFLICT_STATUS]);

export function OwnerApprovalsClient({ initialLeads }: OwnerApprovalsClientProps) {
  const [leads, setLeads] = useState(initialLeads);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  function updateLead(updatedLead: SheetLead) {
    setLeads((current) =>
      current.map((lead) => (lead.leadId === updatedLead.leadId ? updatedLead : lead)),
    );
  }

  async function decideLead(leadId: string, action: DecisionAction, reason?: string) {
    setNotice(null);
    setBusyAction({ leadId, action });

    const form = new FormData();
    form.set("leadId", leadId);
    if (reason) form.set("reason", reason);

    try {
      const response = await fetch(`/api/owner/booking/${action}`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = await readDecisionResponse(response);

      if (!response.ok || !payload?.ok) {
        const updatedLead = decisionPayloadLead(payload);
        if (updatedLead) updateLead(updatedLead);
        setNotice({
          tone: "error",
          message: decisionErrorMessage(payload),
        });
        return;
      }

      updateLead(payload.lead);
      setNotice({
        tone: "success",
        message:
          action === "approve"
            ? "Appointment approved and added to Google Calendar."
            : "Request declined.",
      });
    } catch {
      setNotice({
        tone: "error",
        message: "This request could not be updated. Please try again.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="owner-lead-list">
      {notice ? (
        <div
          className={`owner-notice owner-notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      ) : null}

      {leads.length === 0 ? (
        <div className="owner-empty">
          <h2>No pending requests.</h2>
          <p>New website requests with Pending Approval status will appear here.</p>
        </div>
      ) : null}

      {leads.map((lead) => (
        <OwnerLeadCard
          busyAction={busyAction}
          key={lead.leadId}
          lead={lead}
          onDecide={decideLead}
        />
      ))}
    </div>
  );
}

function OwnerLeadCard({
  busyAction,
  lead,
  onDecide,
}: {
  busyAction: BusyAction;
  lead: SheetLead;
  onDecide: (leadId: string, action: DecisionAction, reason?: string) => Promise<void>;
}) {
  const [declineReason, setDeclineReason] = useState("Requested time unavailable");
  const isApproveBusy = busyAction?.leadId === lead.leadId && busyAction.action === "approve";
  const isDeclineBusy = busyAction?.leadId === lead.leadId && busyAction.action === "decline";
  const isBusy = busyAction !== null;
  const isFinal = finalStatuses.has(lead.status);

  return (
    <article className="owner-lead">
      <div className="owner-lead__header">
        <div>
          <p className="eyebrow">{lead.status}</p>
          <h2>{lead.name}</h2>
          <p>{lead.leadId}</p>
          <LeadStatusDetails lead={lead} />
        </div>
        <div className="owner-actions owner-actions--compact">
          <a className="button button--ghost" href="/owner">
            Refresh
          </a>
          <form action="/api/owner/session/logout" method="post">
            <button className="button button--dark" type="submit">
              Log Out
            </button>
          </form>
        </div>
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

      {isFinal ? null : (
        <div className="owner-actions">
          <button
            className="button button--primary"
            disabled={isBusy}
            onClick={() => onDecide(lead.leadId, "approve")}
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
              onClick={() => onDecide(lead.leadId, "decline", declineReason)}
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

function LeadStatusDetails({ lead }: { lead: SheetLead }) {
  if (lead.status === APPROVED_STATUS) {
    return (
      <dl className="owner-status-detail">
        <div><dt>Status</dt><dd>Approved</dd></div>
        <div><dt>Confirmed Date</dt><dd>{lead.confirmedDate || lead.requestedDate}</dd></div>
        <div><dt>Confirmed Time</dt><dd>{lead.confirmedTime || lead.requestedTime}</dd></div>
      </dl>
    );
  }

  if (lead.status === DECLINED_STATUS) {
    return (
      <dl className="owner-status-detail">
        <div><dt>Status</dt><dd>Declined</dd></div>
        {lead.declineReason ? <div><dt>Reason</dt><dd>{lead.declineReason}</dd></div> : null}
      </dl>
    );
  }

  if (lead.status === CONFLICT_STATUS) {
    return (
      <p className="owner-inline-error">
        This requested time is no longer available. Please contact the customer to
        choose another time.
      </p>
    );
  }

  return null;
}

async function readDecisionResponse(response: Response) {
  try {
    return (await response.json()) as OwnerDecisionResult | {
      ok?: false;
      message?: string;
      details?: { lead?: SheetLead };
    };
  } catch {
    return null;
  }
}

function decisionErrorMessage(
  payload: Awaited<ReturnType<typeof readDecisionResponse>>,
) {
  const lead = decisionPayloadLead(payload);
  const message = payload && "message" in payload ? payload.message : "";
  if (lead?.status === CONFLICT_STATUS || message === "Requested time is no longer available.") {
    return "This requested time is no longer available. Please contact the customer to choose another time.";
  }
  return message || "This request could not be updated. Please try again.";
}

function decisionPayloadLead(
  payload: Awaited<ReturnType<typeof readDecisionResponse>>,
) {
  if (!payload) return null;
  if ("details" in payload && payload.details?.lead) return payload.details.lead;
  if ("lead" in payload && payload.lead) return payload.lead;
  return null;
}

