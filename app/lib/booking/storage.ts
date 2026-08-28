import { createHash } from "node:crypto";
import { del, get, put, rename } from "@vercel/blob";
import type { PhotoReference } from "./types";
import { validatePhotoFile } from "./validation";

export type StoredPhoto = {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string;
};

export type PhotoAccessResult =
  | {
      ok: true;
      contentType: string;
      name: string;
      size: number;
      stream: ReadableStream<Uint8Array>;
    }
  | { ok: false; status: number; message: string };

export async function storePhoto(file: File): Promise<StoredPhoto> {
  const validationError = validatePhotoFile(file);
  if (validationError) throw new Error(validationError);

  const mode = resolvePhotoStorageMode();
  if (mode === "mock") {
    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    return {
      id: `mock-${digest}`,
      name: sanitizeFileName(file.name),
      url: `mock://photo/${digest}/${sanitizeFileName(file.name)}`,
      size: file.size,
      contentType: file.type,
    };
  }

  if (mode === "vercel-blob") {
    const fileName = sanitizeFileName(file.name);
    const pathname = `booking-photos/pending/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`;
    const blob = await put(pathname, file, {
      access: "private",
      addRandomSuffix: false,
      contentType: file.type,
      storeId: process.env.BLOB_STORE_ID,
    });

    return {
      id: blob.pathname,
      name: fileName,
      url: blob.pathname,
      size: file.size,
      contentType: file.type,
    };
  }

  throw new Error(
    "Photo storage is not configured. Connect a private Vercel Blob store with OIDC, or set PHOTO_STORAGE_MODE=vercel-blob with Blob credentials.",
  );
}

export async function associatePhotosWithLead(
  leadId: string,
  photos: PhotoReference[],
): Promise<PhotoReference[]> {
  if (photos.length === 0) return photos;
  if (resolvePhotoStorageMode() !== "vercel-blob") return photos;

  const associated: PhotoReference[] = [];
  try {
    for (const photo of photos) {
      const sourcePath = normalizeBlobPath(photo.url);
      const targetPath = sourcePath.startsWith(`booking-photos/leads/${leadId}/`)
        ? sourcePath
        : `booking-photos/leads/${leadId}/${crypto.randomUUID()}-${sanitizeFileName(photo.name)}`;
      const result = sourcePath === targetPath
        ? { pathname: targetPath }
        : await rename(sourcePath, targetPath, {
            access: "private",
            addRandomSuffix: false,
            contentType: photo.contentType,
            storeId: process.env.BLOB_STORE_ID,
          });
      associated.push({
        ...photo,
        id: result.pathname,
        url: result.pathname,
        name: sanitizeFileName(photo.name),
      });
    }
    return associated;
  } catch (error) {
    await cleanupPhotos(associated);
    throw error;
  }
}

export async function cleanupPhotos(photos: PhotoReference[]) {
  if (photos.length === 0 || resolvePhotoStorageMode() !== "vercel-blob") return;
  const paths = photos.map((photo) => normalizeBlobPath(photo.url)).filter(Boolean);
  if (paths.length === 0) return;
  try {
    await del(paths, { storeId: process.env.BLOB_STORE_ID });
  } catch {
    // Cleanup is best-effort; do not mask the original booking failure.
  }
}

export async function getPrivatePhoto(
  pathname: string,
  expectedName: string,
): Promise<PhotoAccessResult> {
  const safePath = normalizeBlobPath(pathname);
  if (!safePath.startsWith("booking-photos/leads/")) {
    return { ok: false, status: 404, message: "Photo not found." };
  }

  const result = await get(safePath, {
    access: "private",
    storeId: process.env.BLOB_STORE_ID,
  });
  if (!result || result.statusCode !== 200) {
    return { ok: false, status: 404, message: "Photo not found." };
  }
  return {
    ok: true,
    contentType: result.blob.contentType,
    name: sanitizeFileName(expectedName),
    size: result.blob.size,
    stream: result.stream,
  };
}

export function normalizeBlobPath(value: string) {
  return value.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
}

function resolvePhotoStorageMode() {
  const configuredMode = process.env.PHOTO_STORAGE_MODE;
  if (configuredMode) return configuredMode;

  if (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) {
    return "vercel-blob";
  }

  return "disabled";
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "photo";
}
