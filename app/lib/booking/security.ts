type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const duplicateFingerprints = new Map<string, number>();
const idempotencyResponses = new Map<string, unknown>();

export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  current.count += 1;
  if (current.count > limit) {
    return { ok: false, remaining: 0 };
  }
  return { ok: true, remaining: limit - current.count };
}

export async function readJsonWithLimit(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    return { ok: false as const, status: 413, message: "Request is too large." };
  }

  const text = await readRequestTextWithLimit(request, maxBytes);
  if (!text.ok) return text;

  try {
    return { ok: true as const, value: JSON.parse(text.value) as unknown };
  } catch {
    return { ok: false as const, status: 400, message: "Request could not be read." };
  }
}

export function requestBodyWithinLimit(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length") ?? "0");
  return !Number.isFinite(length) || length <= maxBytes;
}

export async function verifyTurnstile(token: string | undefined, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false };

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip !== "unknown") form.append("remoteip", ip);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  const json = (await response.json()) as { success?: boolean };
  return { ok: Boolean(json.success), skipped: false };
}

export function isLikelyDuplicate(fingerprint: string, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const lastSeen = duplicateFingerprints.get(fingerprint);
  duplicateFingerprints.set(fingerprint, now);
  return Boolean(lastSeen && now - lastSeen < windowMs);
}

export function duplicateFingerprint(parts: string[]) {
  return parts
    .map((part) => part.toLowerCase().replace(/\s+/g, " ").trim())
    .join("|");
}

export function getIdempotentResponse(key: string | undefined) {
  if (!key) return null;
  return idempotencyResponses.get(key) ?? null;
}

export function setIdempotentResponse(key: string | undefined, response: unknown) {
  if (!key) return;
  idempotencyResponses.set(key, response);
}

async function readRequestTextWithLimit(request: Request, maxBytes: number) {
  if (!request.body) return { ok: false as const, status: 400, message: "Request could not be read." };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { ok: false as const, status: 413, message: "Request is too large." };
    }
    chunks.push(value);
  }

  return { ok: true as const, value: new TextDecoder().decode(concatChunks(chunks, received)) };
}

function concatChunks(chunks: Uint8Array[], totalLength: number) {
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}
