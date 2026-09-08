import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_HASH_VERSION = "scrypt-v1";
const KEY_LENGTH = 64;

export function hashContractorPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  const normalized = normalizePassword(password);
  const hash = scryptSync(normalized, salt, KEY_LENGTH).toString("base64url");
  return `${PASSWORD_HASH_VERSION}.${salt}.${hash}`;
}

export function verifyContractorPassword(password: string, storedHash: string) {
  const [version, salt, hash] = storedHash.split(".");
  if (version !== PASSWORD_HASH_VERSION || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(normalizePassword(password), salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function passwordMeetsContractorPolicy(password: string) {
  return normalizePassword(password).length >= 12;
}

function normalizePassword(password: string) {
  return password.trim();
}
