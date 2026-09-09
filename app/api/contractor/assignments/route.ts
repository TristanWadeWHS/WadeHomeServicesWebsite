import {
  requireAnyRoleAsync,
  ROLE_CONTRACTOR,
} from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { listApprovedAssignmentsForContractor } from "@/app/lib/contractors/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await requireAnyRoleAsync(request, [ROLE_CONTRACTOR]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  try {
    const assignments = await listApprovedAssignmentsForContractor(authorization.user.id ?? "");
    return Response.json({ ok: true, assignments });
  } catch (error) {
    logServerError("contractor.assignments.list", error, { contractorId: authorization.user.id });
    return jsonError("Assignments could not be loaded.", 503);
  }
}
