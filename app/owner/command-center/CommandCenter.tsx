"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { groupNotes, type Note } from "../../lib/command-center/model";
import styles from "./command-center.module.css";

const API = "/api/owner/command-center";
type NoteAction = "complete" | "interpret";
async function call(body?: object) {
  const response = await fetch(API, { method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(45000), headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  let data;
  try { data = await response.json(); } catch { throw new Error("Could not reach Command Center. Your draft is preserved; please retry."); }
  if (!response.ok || !data.ok) throw new Error(data.message || "Could not reach Command Center. Please retry.");
  return data;
}
export function CommandCenter() {
  const [original, setOriginal] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<{ id: string; action: NoteAction } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const saveKey = useRef<{ id: string; original: string } | null>(null);
  const reload = useCallback(async () => { const data = await call(); setNotes(data.notes); }, []);
  useEffect(() => { let active = true; call().then(data => { if (active) setNotes(data.notes); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !original.trim()) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (!saveKey.current || saveKey.current.original !== original) saveKey.current = { id: crypto.randomUUID(), original };
      const payload = saveKey.current;
      const result = await call({ action: "save", ...payload });
      setNotes(current => [result.note, ...current.filter(note => note.id !== result.note.id)]);
      setOriginal(""); saveKey.current = null;
      setNotice("Saved. Your original note is in Notes History.");
      // The save is finished. AI and refresh are optional background work and
      // cannot withhold confirmation, the saved row, or release of the button.
      void call({ action: "interpret", id: payload.id }).then(() => reload()).catch(() => {
        // Original remains visible; its Retry AI processing action stays usable.
      });
    } catch (e) {
      setError(e instanceof Error && e.name !== "TimeoutError" && e.name !== "AbortError" ? e.message : "Save could not be confirmed. Your draft is preserved; retrying will not create a duplicate.");
    } finally { setBusy(false); submitting.current = false; }
  }
  async function action(id: string, action: NoteAction) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setActiveAction({ id, action }); setError(""); setNotice("");
    try { const result = await call({ id, action }); setNotice(result.message); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Update failed. Please retry."); }
    finally { submitting.current = false; setBusy(false); setActiveAction(null); }
  }
  const groups = groupNotes(notes);
  function cards(items: Note[], empty: string) {
    return items.length ? items.map(note => (
      <article className={styles.card} key={note.id}>
        <div className={styles.meta}><span>{note.clientName || "General"} · {note.priority}</span><span>{note.timestamp.replace("T", " ")}</span></div>
        <h4>{note.summary || "Awaiting AI processing"}</h4>
        <p>{note.type} · {note.status}{note.followUp === "Yes" ? ` · ${note.followUpDate ? `Follow up ${note.followUpDate}` : "Follow-up date not specified"}` : ""}</p>
        <details><summary>Original note</summary><p className={styles.original}>{note.original}</p></details>
        {note.completedAt ? <p>Completed {note.completedAt.replace("T", " ")}</p> : null}
        <div className={styles.actions}>
          {!note.completedAt && note.status !== "Completed" ? <button type="button" className={`button ${styles.completeButton}`} disabled={busy} aria-busy={activeAction?.id === note.id && activeAction.action === "complete"} onClick={() => action(note.id, "complete")}>
            <span className={styles.actionIcon} aria-hidden="true">✓</span>{activeAction?.id === note.id && activeAction.action === "complete" ? "Completing…" : "Mark Complete"}
          </button> : null}
          {!note.summary ? <button type="button" className={`button ${styles.retryButton}`} disabled={busy} aria-busy={activeAction?.id === note.id && activeAction.action === "interpret"} onClick={() => action(note.id, "interpret")}>
            <span className={styles.actionIcon} aria-hidden="true">↻</span>{activeAction?.id === note.id && activeAction.action === "interpret" ? "Retrying AI…" : "Retry AI Processing"}
          </button> : null}
        </div>
      </article>
    )) : <p className={styles.empty}>{empty}</p>;
  }
  return <div className={styles.root}>
    <header><p className="eyebrow">Owner · Command Center</p><h2>What do we need to take note of today, Mr. Wade?</h2><p>Capture the whole thought. We’ll organize the details and follow-ups.</p></header>
    <form onSubmit={save} className={styles.entry}>
      <label htmlFor="command-center-note">Your note</label>
      <textarea id="command-center-note" rows={7} maxLength={40000} value={original} disabled={busy} onChange={e => setOriginal(e.target.value)} placeholder="A client to follow up with, something to remember, or an idea for later…" required />
      <div className={styles.actions}><button className="button button--primary" disabled={busy || !original.trim()} type="submit">{busy ? "Working…" : "Save Note"}</button><span>Dates use Pacific time.</span></div>
      {busy ? <p role="status">Saving your note…</p> : null}
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
      <details className={styles.history}><summary>Completed history</summary>{cards(groups.completed, "No completed notes yet.")}</details>
    </>}
  </div>;
}
