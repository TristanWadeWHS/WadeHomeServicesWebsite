import { getLeadById } from "@/app/lib/booking/google";
import {
  requireAnyRole,
  ROLE_FIELD_MANAGER,
  ROLE_OWNER,
} from "@/app/lib/booking/ownerAuth";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit } from "@/app/lib/booking/security";
import { getPrivatePhoto, normalizeBlobPath } from "@/app/lib/booking/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`operations-photos:${ip}`, 60, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many photo requests.", 429);

  const authorization = requireAnyRole(request, [ROLE_OWNER, ROLE_FIELD_MANAGER]);
  if (!authorization.ok) return jsonError(authorization.message, authorization.status);

  const url = new URL(request.url);
  const leadId = url.searchParams.get("leadId") ?? "";
  const photoId = url.searchParams.get("photoId") ?? "";
  if (!leadId || !photoId) return jsonError("Photo not found.", 404);

  try {
    const lead = await getLeadById(leadId);
    if (!lead) return jsonError("Photo not found.", 404);

    const photo = lead.photos.find((item) => item.id === photoId || item.url === photoId);
    if (!photo) return jsonError("Photo not found.", 404);

    const photoPath = normalizeBlobPath(photo.url);
    if (!photoPath.startsWith(`booking-photos/leads/${lead.leadId}/`)) {
      return jsonError("Photo not found.", 404);
    }

    const result = await getPrivatePhoto(photoPath, photo.name);
    if (!result.ok) return jsonError(result.message, result.status);

    return new Response(result.stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${contentDispositionName(result.name)}"`,
        "Content-Length": String(result.size),
        "Content-Type": result.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logServerError("operations.photos", error, { ip, leadId });
    return jsonError("Photo could not be loaded.", 503);
  }
}

function contentDispositionName(value: string) {
  return value.replace(/["\\\r\n]/g, "-");
}
