import { isSameOriginRequest, requireRole, ROLE_OWNER } from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, readJsonWithLimit } from "@/app/lib/booking/security";
import {
  contractorDatabaseConfigured,
  createContractorAccount,
  listContractorAccounts,
} from "@/app/lib/contractors/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);
  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);
  if (!contractorDatabaseConfigured()) return Response.json({ ok: true, contractors: [] });

  try {
    return Response.json({ ok: true, contractors: await listContractorAccounts() });
  } catch (error) {
    logServerError("owner.contractors.list", error);
    return jsonError("Contractor accounts could not be loaded.", 503);
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`owner-contractor-create:${ip}`, 12, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many contractor account attempts.", 429);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = requireRole(request, ROLE_OWNER);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const body = await readJsonWithLimit(request, 16 * 1024);
  if (!body.ok) return jsonError(body.message, body.status);

  const data = body.value as {
    displayName?: unknown;
    email?: unknown;
    temporaryPassword?: unknown;
  };

  try {
    const result = await createContractorAccount({
      displayName: String(data.displayName ?? ""),
      email: String(data.email ?? ""),
      temporaryPassword: String(data.temporaryPassword ?? ""),
      invitedBy: authorization.user.label,
    });
    if (!result.ok) return jsonError(result.message, result.status);
    return Response.json({ ok: true, contractor: result.account });
  } catch (error) {
    logServerError("owner.contractors.create", error, { ip });
    return jsonError("Contractor account could not be created.", 503);
  }
}
