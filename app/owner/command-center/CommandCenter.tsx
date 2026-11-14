"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORIES, PRIORITIES, groupNotes, type Note } from "../../lib/command-center/model";
import styles from "./command-center.module.css";

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(date);
}
const API = "/api/owner/command-center";
type NoteAction = "complete" | "cancel" | "complete-followup";
async function call(body?: object) {
  const response = await fetch(API, { method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(45000), headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  let data;
  try { data = await response.json(); } catch { throw new Error("Could not reach Command Center. Your draft is preserved; please retry."); }
  if (!response.ok || !data.ok) throw new Error(data.message || "Could not reach Command Center. Please retry.");
  return data;
}
export function CommandCenter() {
  const [original, setOriginal] = useState("");
  const [clientName, setClientName] = useState("");
  const [category, setCategory] = useState("General");
  const [priority, setPriority] = useState("Normal");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<{ id: string; action: NoteAction } | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [followUpId, setFollowUpId] = useState<string | null>(null);
  const [nextStep, setNextStep] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const saveKey = useRef<{ id: string; original: string; fingerprint: string } | null>(null);
  const reload = useCallback(async () => { const data = await call(); setNotes(data.notes); }, []);
  useEffect(() => { let active = true; call().then(data => { if (active) setNotes(data.notes); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !original.trim()) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const details = { clientName, type: category, priority, followUpDate };
      const fingerprint = JSON.stringify({ original, details });
      if (!saveKey.current || saveKey.current.fingerprint !== fingerprint) saveKey.current = { id: crypto.randomUUID(), original, fingerprint };
      const payload = { id: saveKey.current.id, original, details };
      const result = await call({ action: "save", ...payload });
      setNotes(current => [result.note, ...current.filter(note => note.id !== result.note.id)]);
      setOriginal(""); saveKey.current = null;
      setClientName(""); setCategory("General"); setPriority("Normal"); setFollowUpDate("");
      setNotice("Saved with your selected details. Follow-ups appear under Overdue or Upcoming.");
    } catch (e) {
      setError(e instanceof Error && e.name !== "TimeoutError" && e.name !== "AbortError" ? e.message : "Save could not be confirmed. Your draft is preserved; retrying will not create a duplicate.");
    } finally { setBusy(false); submitting.current = false; }
  }
  async function action(id: string, action: NoteAction) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setActiveAction({ id, action }); setError(""); setNotice("");
    try { const result = await call({ id, action, ...(action === "cancel" ? { reason } : action === "complete-followup" ? { nextStep, followUpDate: nextDate } : {}) }); setNotice(result.message);
      setCancellingId(null); setReason(""); setFollowUpId(null); setNextStep(""); setNextDate("");
      await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Update failed. Please retry."); }
    finally { submitting.current = false; setBusy(false); setActiveAction(null); }
  }
  const groups = groupNotes(notes);
  function cards(items: Note[], empty: string) {
    return items.length ? items.map(note => (
      <article className={styles.card} key={note.id}>
        <div className={styles.meta}><span className={note.priority === "Urgent" || note.priority === "High" ? styles.important : undefined}>{note.priority || "Normal"} priority</span><span>{displayTime(note.timestamp)} PT</span></div>
        <h4>{note.clientName.trim() || "No client name"}</h4>
        <p className={styles.original}>{note.original}</p>
        {note.parentNoteId ? <details><summary>Previous note</summary><p className={styles.original}>{notes.find(previous => previous.id === note.parentNoteId)?.original || "Linked to an earlier note."}</p></details> : null}
        {notes.filter(next => next.parentNoteId === note.id).map(next => <p key={next.id}>Follow-up: {next.followUpDate} · {next.status === "Cancelled" ? "Cancelled" : next.completedAt ? "Completed" : "Open"}</p>)}
        <p>{note.status === "Cancelled" ? "Cancelled" : note.completedAt || note.status === "Completed" ? "Completed" : note.followUp === "Yes" ? `Follow up: ${note.followUpDate || "Choose a date"}` : "Saved · No follow-up scheduled"}</p>
        {note.summary ? <details><summary>AI summary</summary><p>{note.summary}</p></details> : null}
        {note.completedAt ? <p>{note.status === "Cancelled" ? "Cancelled" : "Completed"} {displayTime(note.completedAt)}</p> : null}
        {note.cancellationReason ? <p className={styles.original}><strong>Cancellation reason:</strong> {note.cancellationReason}</p> : null}
        <div className={styles.actions}>
          {!note.completedAt && note.status !== "Completed" && note.status !== "Cancelled" ? <button type="button" className={`button ${styles.completeButton}`} disabled={busy} aria-busy={activeAction?.id === note.id && activeAction.action === "complete"} onClick={() => action(note.id, "complete")}>
            <span className={styles.actionIcon} aria-hidden="true">✓</span>{activeAction?.id === note.id && activeAction.action === "complete" ? "Completing…" : "Mark Complete"}
          </button> : null}
          {!note.completedAt && note.status !== "Completed" && note.status !== "Cancelled" ? <button type="button" className={`button ${styles.retryButton}`} disabled={busy} onClick={() => { setFollowUpId(note.id); setNextStep(""); setNextDate(""); setCancellingId(null); setError(""); }}>Complete + Follow-up</button> : null}
          {!note.completedAt && note.status !== "Completed" && note.status !== "Cancelled" ? <button type="button" className={`button ${styles.cancelButton}`} disabled={busy} onClick={() => { setCancellingId(note.id); setFollowUpId(null); setReason(""); setError(""); }}>Mark Cancelled</button> : null}
        </div>
        {followUpId === note.id ? <form className={styles.cancellation} onSubmit={event => { event.preventDefault(); void action(note.id, "complete-followup"); }}>
          <p>Complete this note and create a linked follow-up for {note.clientName || "the same client"}.</p>
          <label htmlFor={`next-step-${note.id}`}>Next step</label>
          <textarea autoFocus id={`next-step-${note.id}`} value={nextStep} onChange={event => setNextStep(event.target.value)} maxLength={40000} rows={3} required disabled={busy} />
          <label htmlFor={`next-date-${note.id}`}>Follow-up date</label>
          <input id={`next-date-${note.id}`} type="date" value={nextDate} onChange={event => setNextDate(event.target.value)} required disabled={busy} />
          <div className={styles.actions}>
            <button type="submit" className={`button ${styles.completeButton}`} disabled={busy || !nextStep.trim() || !nextDate}>{activeAction?.action === "complete-followup" ? "Saving…" : "Complete & Schedule Follow-up"}</button>
            <button type="button" className="button" disabled={busy} onClick={() => { setFollowUpId(null); setNextStep(""); setNextDate(""); }}>Keep Note Open</button>
          </div>
        </form> : null}
        {cancellingId === note.id ? <form className={styles.cancellation} onSubmit={event => { event.preventDefault(); void action(note.id, "cancel"); }}>
          <label htmlFor={`cancel-reason-${note.id}`}>Why is this note being cancelled?</label>
          <textarea autoFocus id={`cancel-reason-${note.id}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} rows={3} required disabled={busy} />
          <div className={styles.actions}>
            <button type="submit" className={`button ${styles.cancelButton}`} disabled={busy || !reason.trim()}>{activeAction?.action === "cancel" ? "Cancelling…" : "Confirm Cancellation"}</button>
            <button type="button" className="button" disabled={busy} onClick={() => { setCancellingId(null); setReason(""); }}>Keep Note Open</button>
          </div>
        </form> : null}
      </article>
    )) : <p className={styles.empty}>{empty}</p>;
  }
  return <div className={styles.root}>
    <header><p className="eyebrow">Owner · Command Center</p><h2>What do we need to take note of today, Mr. Wade?</h2><p>Choose a category, add the details, and set a follow-up date when you need to take action.</p></header>
    <form onSubmit={save} className={styles.entry}>
      <div className={styles.fields}>
        <label>Category<select value={category} disabled={busy} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Client name (optional)<input value={clientName} maxLength={200} disabled={busy} onChange={e => setClientName(e.target.value)} placeholder="Client name" /></label>
        <label>Priority<select value={priority} disabled={busy} onChange={e => setPriority(e.target.value)}>{PRIORITIES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Follow-up date (optional)<input type="date" value={followUpDate} disabled={busy} onChange={e => setFollowUpDate(e.target.value)} /></label>
      </div>
      <p>Leave the date blank to save without a scheduled follow-up. Dates organize your notes here; they do not send reminders.</p>
      <label htmlFor="command-center-note">Your note</label>
      <textarea id="command-center-note" rows={7} maxLength={40000} value={original} disabled={busy} onChange={e => setOriginal(e.target.value)} placeholder="A client to follow up with, something to remember, or an idea for later…" required />
      <div className={styles.actions}><button className="button button--primary" disabled={busy || !original.trim()} type="submit">{busy ? "Working…" : "Save Note"}</button><span>Dates use Pacific time.</span></div>
      {busy ? <p role="status">{activeAction ? "Updating note…" : "Saving your note…"}</p> : null}
      {notice ? <p role="status" className={styles.success}>{notice}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </form>
    {error ? <button type="button" disabled={busy} onClick={() => { setError(""); reload().catch(e => setError(e.message)); }}>Refresh notes</button> : null}
    {loading ? <p role="status">Loading notes…</p> : <>
      <div className={styles.columns}>
        <section><h3>Overdue</h3>{cards(groups.overdue, "No overdue follow-ups.")}</section>
        <section><h3>Upcoming</h3><p>Today, future dates, and follow-ups awaiting a date.</p>{cards(groups.upcoming, "No upcoming follow-ups.")}</section>
      </div>
      <section><h3>General Notes</h3>{cards(groups.general, "No general notes yet.")}</section>
      <details className={styles.history}><summary>Cancelled history</summary>{cards(groups.cancelled, "No cancelled notes yet.")}</details>
      <details className={styles.history}><summary>Completed history</summary>{cards(groups.completed, "No completed notes yet.")}</details>
    </>}
  </div>;
}
