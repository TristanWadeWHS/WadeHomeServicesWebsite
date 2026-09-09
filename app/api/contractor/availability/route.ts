import {
  isSameOriginRequest,
  requireAnyRoleAsync,
  ROLE_CONTRACTOR,
} from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, readJsonWithLimit } from "@/app/lib/booking/security";
import {
  createContractorAvailability,
  listAvailabilityForContractor,
  updateContractorAvailability,
  withdrawContractorAvailability,
} from "@/app/lib/contractors/database";
import type { ContractorAvailabilityInput } from "@/app/lib/contractors/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await requireAnyRoleAsync(request, [ROLE_CONTRACTOR]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  try {
    const availability = await listAvailabilityForContractor(authorization.user.id ?? "");
    return Response.json({ ok: true, availability });
  } catch (error) {
    logServerError("contractor.availability.list", error, { contractorId: authorization.user.id });
    return jsonError("Availability could not be loaded.", 503);
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`contractor-availability-create:${ip}`, 40, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many availability updates.", 429);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = await requireAnyRoleAsync(request, [ROLE_CONTRACTOR]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const body = await readJsonWithLimit(request, 16 * 1024);
  if (!body.ok) return jsonError(body.message, body.status);

  try {
    const result = await createContractorAvailability(body.value as ContractorAvailabilityInput, {
      id: authorization.user.id ?? "",
      isOwner: false,
      label: authorization.user.label,
    });
    if (!result.ok) return jsonError(result.message, result.status);
    return Response.json({ ok: true, availability: result.availability });
  } catch (error) {
    logServerError("contractor.availability.create", error, { ip, contractorId: authorization.user.id });
    return jsonError("Availability could not be saved.", 503);
  }
}

export async function PUT(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`contractor-availability-update:${ip}`, 40, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many availability updates.", 429);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = await requireAnyRoleAsync(request, [ROLE_CONTRACTOR]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const body = await readJsonWithLimit(request, 16 * 1024);
  if (!body.ok) return jsonError(body.message, body.status);
  const data = body.value as ContractorAvailabilityInput & { availabilityId?: string };
  if (!data.availabilityId) return jsonError("Availability ID is required.", 400);

  try {
    const result = await updateContractorAvailability(data.availabilityId, data, {
      id: authorization.user.id ?? "",
      isOwner: false,
      label: authorization.user.label,
    });
    if (!result.ok) return jsonError(result.message, result.status);
    return Response.json({ ok: true, availability: result.availability });
  } catch (error) {
    logServerError("contractor.availability.update", error, { ip, contractorId: authorization.user.id });
    return jsonError("Availability could not be updated.", 503);
  }
}

export async function DELETE(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`contractor-availability-withdraw:${ip}`, 40, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many availability updates.", 429);
  if (!isSameOriginRequest(request)) return jsonError("Unauthorized.", 401);

  const authorization = await requireAnyRoleAsync(request, [ROLE_CONTRACTOR]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const body = await readJsonWithLimit(request, 4 * 1024);
  if (!body.ok) return jsonError(body.message, body.status);
  const availabilityId = String((body.value as { availabilityId?: unknown }).availabilityId ?? "");
  if (!availabilityId) return jsonError("Availability ID is required.", 400);

  try {
    const result = await withdrawContractorAvailability(availabilityId, {
      id: authorization.user.id ?? "",
      isOwner: false,
      label: authorization.user.label,
    });
    if (!result.ok) return jsonError(result.message, result.status);
    return Response.json({ ok: true, availability: result.availability });
  } catch (error) {
    logServerError("contractor.availability.withdraw", error, { ip, contractorId: authorization.user.id });
    return jsonError("Availability could not be withdrawn.", 503);
  }
}
