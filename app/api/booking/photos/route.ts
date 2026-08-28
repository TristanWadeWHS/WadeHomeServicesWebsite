import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit, requestBodyWithinLimit } from "@/app/lib/booking/security";
import { cleanupPhotos } from "@/app/lib/booking/storage";
import type { PhotoReference } from "@/app/lib/booking/types";
import {
  MAX_PHOTO_SIZE_BYTES,
  VALID_IMAGE_CONTENT_TYPES,
  VALID_IMAGE_TYPES,
  validatePhotoReference,
} from "@/app/lib/booking/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`photos:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many photo upload attempts. Try again soon.", 429);

  if (!requestBodyWithinLimit(request, 32 * 1024)) {
    return jsonError("Photo upload request is too large.", 413);
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        if (multipart) throw new Error("Multipart photo uploads are not enabled.");
        if (!isSafePendingUploadPath(pathname)) throw new Error("Invalid photo upload path.");
        const payload = parseClientPayload(clientPayload);
        if (payload.contentType && !VALID_IMAGE_TYPES.has(payload.contentType)) {
          throw new Error("Unsupported photo type.");
        }
        if (payload.size > MAX_PHOTO_SIZE_BYTES) {
          throw new Error("Photo is too large.");
        }
        return {
          allowedContentTypes: [...VALID_IMAGE_CONTENT_TYPES],
          maximumSizeInBytes: MAX_PHOTO_SIZE_BYTES,
          addRandomSuffix: false,
          tokenPayload: clientPayload,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    const safeError = safePhotoUploadError(error);
    logServerError("booking.photos", new Error(safeError.message), { ip });
    return jsonError(safeError.message, safeError.status);
  }
}

export async function DELETE(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`photos-delete:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many photo cleanup attempts.", 429);

  try {
    const body = await request.json() as { photos?: PhotoReference[] };
    const photos = Array.isArray(body.photos) ? body.photos : [];
    const pendingPhotos = photos.filter((photo) => {
      return !validatePhotoReference(photo) && photo.url.startsWith("booking-photos/pending/");
    });
    await cleanupPhotos(pendingPhotos);
    return Response.json({ ok: true });
  } catch (error) {
    logServerError("booking.photos.delete", error, { ip });
    return jsonError("Photo cleanup failed.", 400);
  }
}

function isSafePendingUploadPath(pathname: string) {
  const normalized = pathname.replace(/^\/+/, "");
  return (
    normalized === pathname &&
    normalized.startsWith("booking-photos/pending/") &&
    normalized.length <= 260 &&
    !normalized.includes("..") &&
    !normalized.includes("\\") &&
    !normalized.includes("\0") &&
    !/^https?:\/\//i.test(normalized)
  );
}

function parseClientPayload(clientPayload: string | null) {
  if (!clientPayload) return { contentType: "", size: 0 };
  try {
    const parsed = JSON.parse(clientPayload) as { contentType?: unknown; size?: unknown };
    return {
      contentType: typeof parsed.contentType === "string" ? parsed.contentType : "",
      size: typeof parsed.size === "number" ? parsed.size : 0,
    };
  } catch {
    return { contentType: "", size: 0 };
  }
}

function safePhotoUploadError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/too large|size|10 MB/i.test(message)) {
    return { status: 413, message: "Each photo must be 10 MB or smaller." };
  }
  if (/unsupported|content type|type|invalid photo upload path|multipart/i.test(message)) {
    return { status: 400, message: "Use JPG, PNG, WEBP, HEIC, or HEIF images." };
  }
  if (/token|blob|store|credential|BLOB_/i.test(message)) {
    return {
      status: 503,
      message: "Photo upload is temporarily unavailable. Please try again or continue without photos.",
    };
  }
  return { status: 400, message: "Photo upload failed. Please try again or continue without photos." };
}
