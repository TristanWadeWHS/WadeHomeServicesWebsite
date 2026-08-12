import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { validatePhotoFile } from "./validation";

export type StoredPhoto = {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string;
};

export async function storePhoto(file: File): Promise<StoredPhoto> {
  const validationError = validatePhotoFile(file);
  if (validationError) throw new Error(validationError);

  const mode = process.env.PHOTO_STORAGE_MODE || "disabled";
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
    const pathname = `booking-photos/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`;
    const blob = await put(pathname, file, {
      access: "private",
      addRandomSuffix: false,
      contentType: file.type,
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
    "Photo storage is not configured. Set PHOTO_STORAGE_MODE=vercel-blob and BLOB_READ_WRITE_TOKEN.",
  );
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "photo";
}
