import assert from "node:assert/strict";
import test from "node:test";
import { latestConsent, maySendMessage, validateConsent } from "../app/lib/messaging/consent.ts";

const grant = (overrides = {}) => ({
  id: "c1", customerId: "customer-1", channel: "sms", purpose: "appointment",
  state: "granted", source: "staff_documented", recordedAt: "2026-11-21T19:00:00Z",
  disclosureVersion: "appointment-sms-v1", evidenceReference: "lead:123:customer-verbal-consent",
  recordedBy: "owner-1", ...overrides,
});
const message = (overrides = {}) => ({
  id: "m1", customerId: "customer-1", appointmentId: "appointment-1",
  channel: "sms", purpose: "appointment", templateKey: "appointment-confirmation-v1",
  idempotencyKey: "appointment-1:confirmation:sms:v1", scheduledFor: "2026-11-21T20:00:00Z", ...overrides,
});
test("requires auditable evidence", () => {
  assert.deepEqual(validateConsent(grant()), []);
  assert.ok(validateConsent(grant({ evidenceReference: "" })).length);
});
test("fails closed without matching channel and purpose", () => {
  assert.equal(maySendMessage(message(), [], false).allowed, false);
  assert.equal(maySendMessage(message({ purpose: "marketing" }), [grant()], false).allowed, false);
  assert.equal(maySendMessage(message({ channel: "email" }), [grant()], false).allowed, false);
  assert.equal(maySendMessage(message(), [grant()], false).allowed, true);
});
test("revocation and global suppression override earlier grant", () => {
  const records = [grant(), grant({ id: "c2", state: "revoked", recordedAt: "2026-11-21T19:01:00Z" })];
  assert.equal(latestConsent(records, "customer-1", "sms", "appointment")?.state, "revoked");
  assert.equal(maySendMessage(message(), records, false).allowed, false);
  assert.equal(maySendMessage(message(), [grant()], true).allowed, false);
});
test("invalid evidence never authorizes sends", () => {
  assert.equal(maySendMessage(message(), [grant({ disclosureVersion: "" })], false).allowed, false);
  assert.equal(maySendMessage(message({ appointmentId: undefined }), [grant()], false).allowed, false);
});
