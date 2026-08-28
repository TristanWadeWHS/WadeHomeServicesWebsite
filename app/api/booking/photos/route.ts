import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit } from "@/app/lib/booking/security";
import { cleanupPhotos, storePhoto } from "@/app/lib/booking/storage";
import type { PhotoReference } from "@/app/lib/booking/types";
import {
  MAX_PHOTO_AGGREGATE_SIZE_BYTES,
  MAX_PHOTO_COUNT,
  validatePhotoReference,
} from "@/app/lib/booking/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`photos:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many photo upload attempts. Try again soon.", 429);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_PHOTO_AGGREGATE_SIZE_BYTES + 1024 * 1024) {
    return jsonError("The selected photos are too large.", 413);
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("photos").filter((entry): entry is File => {
      return typeof entry === "object" && "arrayBuffer" in entry;
    });

    if (files.length < 1) return jsonError("At least one photo is required.");
    if (files.length > MAX_PHOTO_COUNT) {
      return jsonError(`Upload no more than ${MAX_PHOTO_COUNT} photos.`);
    }
    const aggregateSize = files.reduce((total, file) => total + file.size, 0);
    if (aggregateSize > MAX_PHOTO_AGGREGATE_SIZE_BYTES) {
      return jsonError("Upload no more than 50 MB of photos per request.", 413);
    }

    const stored = [];
    try {
      for (const file of files) {
        stored.push(await storePhoto(file));
      }

      return Response.json({ ok: true, photos: stored });
    } catch (error) {
      await cleanupPhotos(stored);
      throw error;
    }
  } catch (error) {
    logServerError("booking.photos", error, { ip });
    const message =
      error instanceof Error ? error.message : "Photo upload failed. Try again.";
    return jsonError(message, 400);
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
