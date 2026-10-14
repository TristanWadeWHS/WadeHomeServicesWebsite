import { requireRole, ROLE_OWNER, isSameOriginRequest } from "../../../lib/booking/ownerAuth";
import { CommandCenterError, readNotes, saveOriginal, findNote, completeNote } from "../../../lib/command-center/store";
import { interpretNote } from "../../../lib/command-center/interpret";
import { readJsonWithLimit } from "../../../lib/booking/security";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (value: object, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function authorize(request: Request) {
  const auth = requireRole(request, ROLE_OWNER);
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status);
  if (request.method !== "GET" && !isSameOriginRequest(request)) return json({ ok: false, message: "Forbidden." }, 403);
}
function failure(error: unknown) {
  return json({ ok: false, message: error instanceof CommandCenterError ? error.message : "Command Center is unavailable. Your draft is preserved; please retry." }, error instanceof CommandCenterError ? error.status : 503);
}
export async function GET(request: Request) {
  const denied = authorize(request); if (denied) return denied;
  try { return json({ ok: true, notes: await readNotes() }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const denied = authorize(request); if (denied) return denied;
  try {
    const parsed = await readJsonWithLimit(request, 250000);
    if (!parsed.ok) return json({ ok: false, message: parsed.message }, parsed.status);
    const body = parsed.value as { id?: string; action?: string; original?: string } | null;
    if (!body || typeof body !== "object" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.id || "")) return json({ ok: false, message: "Invalid note save key." }, 400);
    const id = body.id!;
    if (body.action === "save") {
      if (typeof body.original !== "string" || !body.original.trim() || body.original.length > 40000) return json({ ok: false, message: "Enter a note of 1–40,000 characters." }, 400);
      const note = await saveOriginal(id, body.original);
      // Return durable save confirmation before attempting optional AI processing.
      return json({ ok: true, message: "Saved.", note });
    }
    if (body.action === "complete") { await completeNote(id); return json({ ok: true, message: "Note marked complete." }); }
    if (body.action === "interpret") {
      const { note } = await findNote(id);
      const interpreted = await interpretNote(note);
      return json({ ok: true, interpreted, message: interpreted ? "Note organized." : "Original note saved. AI processing is pending; you can retry later." });
    }
    return json({ ok: false, message: "Unknown action." }, 400);
  } catch (error) { return failure(error); }
}
