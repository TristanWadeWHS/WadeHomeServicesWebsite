import { jsonError, logServerError } from "@/app/lib/booking/responses";
import { clientIp, rateLimit } from "@/app/lib/booking/security";
import { storePhoto } from "@/app/lib/booking/storage";
import { MAX_PHOTO_COUNT } from "@/app/lib/booking/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`photos:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) return jsonError("Too many photo upload attempts. Try again soon.", 429);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 160 * 1024 * 1024) {
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

    const stored = [];
    for (const file of files) {
      stored.push(await storePhoto(file));
    }

    return Response.json({ ok: true, photos: stored });
  } catch (error) {
    logServerError("booking.photos", error, { ip });
    const message =
      error instanceof Error ? error.message : "Photo upload failed. Try again.";
    return jsonError(message, 400);
  }
}
