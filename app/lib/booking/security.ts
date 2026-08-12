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
