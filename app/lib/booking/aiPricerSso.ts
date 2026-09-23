import { createHmac, randomUUID } from "node:crypto";

const ASSERTION_VERSION = 1;
const ASSERTION_ISSUER = "wade-home-services";
const ASSERTION_AUDIENCE = "whs-ai-pricer";
const ASSERTION_SUBJECT = "owner";
const ASSERTION_LIFETIME_SECONDS = 60;

export function aiPricerIntegrationConfigured() {
  return Boolean(process.env.AI_PRICER_URL && process.env.AI_PRICER_SSO_SECRET);
}

export function aiPricerExchangeUrl() {
  const configuredUrl = process.env.AI_PRICER_URL;
  if (!configuredUrl) throw new Error("AI_PRICER_URL is not configured.");

  const url = new URL(configuredUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("AI_PRICER_URL must use HTTPS.");
  }

  url.pathname = "/api/integrations/whs/session";
  url.search = "";
  url.hash = "";
  return url;
}

export function createAiPricerAssertion(now = Date.now()) {
  const secret = process.env.AI_PRICER_SSO_SECRET;
  if (!secret) throw new Error("AI_PRICER_SSO_SECRET is not configured.");

  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      v: ASSERTION_VERSION,
      iss: ASSERTION_ISSUER,
      aud: ASSERTION_AUDIENCE,
      sub: ASSERTION_SUBJECT,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
      jti: randomUUID(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`whs-ai-pricer-assertion.${payload}`)
    .digest("base64url");

  return `${payload}.${signature}`;
}
