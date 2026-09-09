"use client";

import { useState } from "react";
import {
  AVAILABILITY_TYPE_EXCEPTION,
  AVAILABILITY_TYPE_ON_CALL,
  AVAILABILITY_TYPE_REGULAR,
  type ContractorAvailability,
} from "../lib/contractors/types";
import type { OperationsUser } from "../lib/booking/ownerAuth";

type ContractorPortalClientProps = {
  availability: ContractorAvailability[];
  databaseConfigured: boolean;
  user: OperationsUser;
};

type AvailabilityForm = {
  availabilityId: string;
  availabilityType: string;
  scheduleMode: "weekly" | "date";
  dayOfWeek: string;
  availabilityDate: string;
  startTime: string;
  endTime: string;
  notes: string;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

const emptyAvailabilityForm: AvailabilityForm = {
  availabilityId: "",
  availabilityType: AVAILABILITY_TYPE_REGULAR,
  scheduleMode: "weekly",
  dayOfWeek: "1",
  availabilityDate: "",
  startTime: "08:00",
  endTime: "17:00",
  notes: "",
};

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ContractorPortalClient({
  availability,
  databaseConfigured,
  user,
}: ContractorPortalClientProps) {
  const [availabilityRows, setAvailabilityRows] = useState(availability);
  const [form, setForm] = useState(emptyAvailabilityForm);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function saveAvailability() {
    setNotice(null);
    setBusyId(form.availabilityId || "new-availability");
    try {
      const response = await fetch("/api/contractor/availability", {
        method: form.availabilityId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(formPayload(form)),
      });
      const payload = await readJson(response);
      const savedAvailability = payload?.availability;
      if (!response.ok || !payload?.ok || !savedAvailability) {
        setNotice({ tone: "error", message: payload?.message || "Availability could not be saved." });
        return;
      }
      setAvailabilityRows((current) => upsertAvailability(current, savedAvailability));
      setForm(emptyAvailabilityForm);
      setNotice({ tone: "success", message: "Availability saved." });
    } catch {
      setNotice({ tone: "error", message: "Availability could not be saved." });
    } finally {
      setBusyId(null);
    }
  }

  async function withdrawAvailability(availabilityId: string) {
    setNotice(null);
    setBusyId(availabilityId);
    try {
      const response = await fetch("/api/contractor/availability", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ availabilityId }),
      });
      const payload = await readJson(response);
      const withdrawnAvailability = payload?.availability;
      if (!response.ok || !payload?.ok || !withdrawnAvailability) {
        setNotice({ tone: "error", message: payload?.message || "Availability could not be withdrawn." });
        return;
      }
      setAvailabilityRows((current) => upsertAvailability(current, withdrawnAvailability));
      setNotice({ tone: "success", message: "Availability withdrawn." });
    } catch {
      setNotice({ tone: "error", message: "Availability could not be withdrawn." });
    } finally {
      setBusyId(null);
    }
  }

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

      {notice ? (
        <div className={`owner-notice owner-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.message}
        </div>
      ) : null}

      <section className="owner-lead">
        <h3>Confirmed Assignments</h3>
        <p className="portal-empty-copy">
          No confirmed assignments are available yet. When Wade Home Services assigns work to you,
          job-safe details will appear here.
        </p>
      </section>

      <section className="owner-lead">
        <h3>Availability</h3>
        {!databaseConfigured ? (
          <p className="portal-empty-copy">Contractor database setup is required before availability can be saved.</p>
        ) : (
          <>
            <AvailabilityEditor
              busy={Boolean(busyId)}
              form={form}
              onChange={setForm}
              onSave={saveAvailability}
            />
            <AvailabilityList
              availability={availabilityRows}
              busyId={busyId}
              onEdit={setFormFromAvailability}
              onWithdraw={withdrawAvailability}
            />
          </>
        )}
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

  function setFormFromAvailability(row: ContractorAvailability) {
    setForm({
      availabilityId: row.id,
      availabilityType: row.availabilityType,
      scheduleMode: row.availabilityDate ? "date" : "weekly",
      dayOfWeek: String(row.dayOfWeek ?? 1),
      availabilityDate: row.availabilityDate ?? "",
      startTime: row.startTime,
      endTime: row.endTime,
      notes: row.notes,
    });
  }
}

export function AvailabilityEditor({
  busy,
  form,
  onChange,
  onSave,
}: {
  busy: boolean;
  form: AvailabilityForm;
  onChange: (form: AvailabilityForm) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <section className="manual-lead-panel availability-panel" aria-label="Manage availability">
      <div className="field-grid">
        <label className="field">
          <span>Type</span>
          <select
            disabled={busy}
            onChange={(event) => onChange({ ...form, availabilityType: event.target.value })}
            value={form.availabilityType}
          >
            <option value={AVAILABILITY_TYPE_REGULAR}>Regular Availability</option>
            <option value={AVAILABILITY_TYPE_ON_CALL}>On-call Window</option>
            <option value={AVAILABILITY_TYPE_EXCEPTION}>Date-specific Exception</option>
          </select>
        </label>
        <label className="field">
          <span>Schedule</span>
          <select
            disabled={busy}
            onChange={(event) => onChange({ ...form, scheduleMode: event.target.value as "weekly" | "date" })}
            value={form.scheduleMode}
          >
            <option value="weekly">Repeats Weekly</option>
            <option value="date">Specific Date</option>
          </select>
        </label>
        {form.scheduleMode === "weekly" ? (
          <label className="field">
            <span>Day</span>
            <select
              disabled={busy}
              onChange={(event) => onChange({ ...form, dayOfWeek: event.target.value })}
              value={form.dayOfWeek}
            >
              {dayNames.map((day, index) => (
                <option key={day} value={index}>{day}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>Date</span>
            <input
              disabled={busy}
              min={todayDateValue()}
              onChange={(event) => onChange({ ...form, availabilityDate: event.target.value })}
              type="date"
              value={form.availabilityDate}
            />
          </label>
        )}
        <label className="field">
          <span>Start</span>
          <input disabled={busy} onChange={(event) => onChange({ ...form, startTime: event.target.value })} type="time" value={form.startTime} />
        </label>
        <label className="field">
          <span>End</span>
          <input disabled={busy} onChange={(event) => onChange({ ...form, endTime: event.target.value })} type="time" value={form.endTime} />
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea disabled={busy} maxLength={500} onChange={(event) => onChange({ ...form, notes: event.target.value })} value={form.notes} />
      </label>
      <button className="button button--primary" disabled={busy} onClick={onSave} type="button">
        {busy ? "Saving..." : form.availabilityId ? "Save Availability" : "Add Availability"}
      </button>
    </section>
  );
}

function AvailabilityList({
  availability,
  busyId,
  onEdit,
  onWithdraw,
}: {
  availability: ContractorAvailability[];
  busyId: string | null;
  onEdit: (availability: ContractorAvailability) => void;
  onWithdraw: (availabilityId: string) => Promise<void>;
}) {
  if (availability.length === 0) {
    return (
      <div className="owner-empty">
        <h2>No availability yet.</h2>
        <p>Add regular weekly availability or on-call windows when you are available for Wade Home Services work.</p>
      </div>
    );
  }
  return (
    <div className="availability-list">
      {availability.map((row) => (
        <article className="availability-row" key={row.id}>
          <div>
            <p className="eyebrow">{availabilityTypeLabel(row.availabilityType)} / {row.status}</p>
            <h4>{availabilityScheduleLabel(row)}</h4>
            <p>{row.startTime} - {row.endTime} / {row.timezone}</p>
            {row.notes ? <p>{row.notes}</p> : null}
          </div>
          {row.status === "ACTIVE" ? (
            <div className="owner-actions owner-actions--compact">
              <button className="button button--ghost" disabled={Boolean(busyId)} onClick={() => onEdit(row)} type="button">Edit</button>
              <button className="button button--dark" disabled={Boolean(busyId)} onClick={() => onWithdraw(row.id)} type="button">
                {busyId === row.id ? "Withdrawing..." : "Withdraw"}
              </button>
            </div>
          ) : null}
        </article>
      ))}
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
        <label className="field"><span>Name</span><input maxLength={160} name="name" required type="text" /></label>
        <label className="field"><span>Phone</span><input inputMode="tel" name="phone" type="tel" /></label>
        <label className="field"><span>Email</span><input name="email" type="email" /></label>
        <label className="field"><span>Address</span><input maxLength={240} name="streetAddress" type="text" /></label>
        <label className="field"><span>City</span><input maxLength={120} name="city" type="text" /></label>
      </div>
      <label className="field"><span>Opportunity Info</span><textarea maxLength={1400} name="opportunityInfo" required /></label>
      <label className="field"><span>Notes</span><textarea maxLength={800} name="notes" /></label>
      <button className="button button--primary" type="submit">Submit Lead</button>
    </form>
  );
}

function formPayload(form: AvailabilityForm) {
  return {
    availabilityId: form.availabilityId || undefined,
    availabilityType: form.availabilityType,
    dayOfWeek: form.scheduleMode === "weekly" ? Number(form.dayOfWeek) : null,
    availabilityDate: form.scheduleMode === "date" ? form.availabilityDate : null,
    startTime: form.startTime,
    endTime: form.endTime,
    timezone: "America/Los_Angeles",
    notes: form.notes,
  };
}

function upsertAvailability(
  current: ContractorAvailability[],
  updated: ContractorAvailability,
) {
  const exists = current.some((row) => row.id === updated.id);
  if (exists) return current.map((row) => row.id === updated.id ? updated : row);
  return [updated, ...current];
}

async function readJson(response: Response) {
  try {
    return await response.json() as {
      ok: boolean;
      message?: string;
      availability?: ContractorAvailability;
    };
  } catch {
    return null;
  }
}

export function availabilityScheduleLabel(row: ContractorAvailability) {
  if (row.availabilityDate) return row.availabilityDate;
  return row.dayOfWeek === null ? "Specific schedule" : dayNames[row.dayOfWeek];
}

export function availabilityTypeLabel(type: string) {
  if (type === AVAILABILITY_TYPE_ON_CALL) return "On-call";
  if (type === AVAILABILITY_TYPE_EXCEPTION) return "Exception";
  return "Regular";
}

function todayDateValue() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).format(new Date());
}
