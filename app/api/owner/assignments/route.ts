import { getLeadById } from "@/app/lib/booking/google";
import { isSameOriginRequest, requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, readJsonWithLimit } from "@/app/lib/booking/security";
import { assignmentInputFromLead } from "@/app/lib/contractors/assignmentSchedule";
import {
  approveAssignmentProposal,
  cancelApprovedAssignments,
  getAssignmentCandidates,
  listAssignmentsForOwner,
  rejectAssignmentProposal,
  saveAssignmentProposal,
} from "@/app/lib/contractors/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);
  const url = new URL(request.url);
  const leadId = url.searchParams.get("leadId") ?? "";
  if (!leadId) return jsonError("Job ID is required.", 400);

  try {
    const lead = await getLeadById(leadId);
    if (!lead) return jsonError("Job was not found.", 404);
    const input = assignmentInputFromLead(lead);
    if (!input) return jsonError("Job time could not be read.", 400);
    const [assignments, candidates] = await Promise.all([
      listAssignmentsForOwner(leadId),
      getAssignmentCandidates(input),
    ]);
    return Response.json({ ok: true, assignments, candidates, travelBufferMinutes: input.travelBufferMinutes });
  } catch (error) {
    logServerError("owner.assignments.get", error, { leadId });
    return jsonError("Crew assignments could not be loaded.", 503);
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-assignments:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many crew assignment updates.", 429);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const body = await readJsonWithLimit(request, 20 * 1024);
  if (!body.ok) return jsonError(body.message, body.status);
  const data = body.value as {
    action?: unknown;
    leadId?: unknown;
    contractorIds?: unknown;
    requiredCrewSize?: unknown;
    assignmentDate?: unknown;
    assignmentStartTime?: unknown;
    assignmentEndTime?: unknown;
    travelBufferMinutes?: unknown;
    travelBufferOverride?: unknown;
    note?: unknown;
  };
  const leadId = String(data.leadId ?? "");
  const action = String(data.action ?? "");

  try {
    const lead = await getLeadById(leadId);
    if (!lead) return jsonError("Job was not found.", 404);

    if (action === "reject") {
      const result = await rejectAssignmentProposal(leadId, authorization.user.label);
      if (!result.ok) return jsonError(result.message, result.status);
      return Response.json({ ok: true, assignments: result.assignments });
    }
    if (action === "cancel") {
      const result = await cancelApprovedAssignments(leadId, authorization.user.label);
      if (!result.ok) return jsonError(result.message, result.status);
      return Response.json({ ok: true, assignments: result.assignments });
    }

    const contractorIds = Array.isArray(data.contractorIds)
      ? data.contractorIds.map((id) => String(id))
      : [];
    const input = assignmentInputFromLead(lead, {
      contractorIds,
      requiredCrewSize: Number(data.requiredCrewSize ?? 1),
      assignmentDate: String(data.assignmentDate ?? ""),
      assignmentStartTime: String(data.assignmentStartTime ?? ""),
      assignmentEndTime: String(data.assignmentEndTime ?? ""),
      travelBufferMinutes: Number(data.travelBufferMinutes ?? undefined),
      travelBufferOverride: Boolean(data.travelBufferOverride),
      note: String(data.note ?? ""),
    });
    if (!input) return jsonError("Job time could not be read.", 400);

    const proposalResult = action === "approve" && contractorIds.length > 0
      ? await saveAssignmentProposal(input, authorization.user.label)
      : null;
    if (proposalResult && !proposalResult.ok) {
      return Response.json(
        { ok: false, message: proposalResult.message, candidates: proposalResult.candidates },
        { status: proposalResult.status },
      );
    }

    const result = action === "approve"
      ? await approveAssignmentProposal(input, authorization.user.label)
      : action === "propose"
        ? await saveAssignmentProposal(input, authorization.user.label)
        : { ok: false as const, status: 400, message: "Crew assignment action is invalid." };
    if (!result.ok) {
      const assignments = "assignments" in result ? result.assignments : undefined;
      return Response.json(
        { ok: false, message: result.message, assignments, candidates: result.candidates },
        { status: result.status },
      );
    }
    return Response.json({ ok: true, assignments: result.assignments, candidates: result.candidates });
  } catch (error) {
    logServerError("owner.assignments.post", error, { ip, leadId, action });
    return jsonError("Crew assignment could not be updated.", 503);
  }
}
