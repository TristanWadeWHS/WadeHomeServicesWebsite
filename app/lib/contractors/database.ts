import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import {
  ASSIGNMENT_STATUS_APPROVED,
  ASSIGNMENT_STATUS_CANCELED,
  ASSIGNMENT_STATUS_CONFLICT_REVIEW,
  ASSIGNMENT_STATUS_PROPOSED,
  ASSIGNMENT_STATUS_REJECTED,
  AVAILABILITY_STATUS_ACTIVE,
  AVAILABILITY_STATUS_WITHDRAWN,
  AVAILABILITY_TYPE_DESIGNATED_SHIFT,
  AVAILABILITY_TYPE_EXCEPTION,
  AVAILABILITY_TYPE_ON_CALL,
  AVAILABILITY_TYPE_REGULAR,
  CONTRACTOR_STATUS_ACTIVE,
  CONTRACTOR_STATUS_DEACTIVATED,
  type AssignmentCandidate,
  type AssignmentProposalInput,
  type ContractorAccount,
  type ContractorAssignment,
  type ContractorAssignmentStatus,
  type ContractorAvailability,
  type ContractorAvailabilityInput,
  type ContractorAvailabilityType,
} from "./types";
import {
  hashContractorPassword,
  passwordMeetsContractorPolicy,
  verifyContractorPassword,
} from "./passwords";

type ContractorAccountRow = {
  id: string;
  display_name: string;
  email: string;
  status: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  password_hash?: string;
};

type ContractorAvailabilityRow = {
  id: string;
  contractor_id: string;
  contractor_name: string | null;
  availability_type: string;
  day_of_week: number | null;
  availability_date: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  status: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  withdrawn_at: string | null;
};

type ContractorAssignmentRow = {
  id: string;
  lead_id: string;
  contractor_id: string;
  contractor_name: string | null;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  service_types: string;
  city: string;
  access_notes: string;
  calendar_sync_status: string;
  job_name: string;
  required_crew_size: number;
  travel_buffer_minutes: number;
  travel_buffer_override: boolean;
  proposed_by: string;
  proposed_at: string;
  approved_at: string | null;
  approved_by: string;
  rejected_at: string | null;
  rejected_by: string;
  canceled_at: string | null;
  canceled_by: string;
  conflict_flagged_at: string | null;
  conflict_reason: string;
  audit_trail: string;
  created_at: string;
  updated_at: string;
};

type CreateContractorAccountInput = {
  displayName: string;
  email: string;
  temporaryPassword: string;
  invitedBy: string;
};

export type ContractorAccountResult =
  | { ok: true; account: ContractorAccount }
  | { ok: false; status: number; message: string };

export type ContractorAvailabilityResult =
  | { ok: true; availability: ContractorAvailability }
  | { ok: false; status: number; message: string };

export type AssignmentProposalResult =
  | { ok: true; assignments: ContractorAssignment[]; candidates: AssignmentCandidate[]; message?: string }
  | { ok: false; status: number; message: string; candidates?: AssignmentCandidate[] };

export type AssignmentDecisionResult =
  | { ok: true; assignments: ContractorAssignment[]; candidates?: AssignmentCandidate[] }
  | { ok: false; status: number; message: string; assignments?: ContractorAssignment[]; candidates?: AssignmentCandidate[] };

export function contractorDatabaseConfigured() {
  return Boolean(process.env.CONTRACTOR_DATABASE_URL || process.env.POSTGRES_URL);
}

export async function authenticateContractorAccount(email: string, password: string) {
  if (!contractorDatabaseConfigured()) return null;
  await ensureContractorSchema();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) return null;

  const sql = contractorSql();
  const rows = await sql`
    SELECT id, display_name, email, status, created_at, updated_at, deactivated_at, password_hash
    FROM contractor_accounts
    WHERE email_normalized = ${normalizedEmail}
    LIMIT 1
  ` as ContractorAccountRow[];
  const row = rows[0];
  if (!row || row.status !== CONTRACTOR_STATUS_ACTIVE || !row.password_hash) return null;
  if (!verifyContractorPassword(password, row.password_hash)) return null;
  await sql`UPDATE contractor_accounts SET last_login_at = now(), updated_at = now() WHERE id = ${row.id}`;
  return rowToAccount(row);
}

export async function getActiveContractorAccount(id: string) {
  if (!contractorDatabaseConfigured()) return null;
  await ensureContractorSchema();
  const sql = contractorSql();
  const rows = await sql`
    SELECT id, display_name, email, status, created_at, updated_at, deactivated_at
    FROM contractor_accounts
    WHERE id = ${id}
    LIMIT 1
  ` as ContractorAccountRow[];
  const row = rows[0];
  if (!row || row.status !== CONTRACTOR_STATUS_ACTIVE) return null;
  return rowToAccount(row);
}

export async function listContractorAccounts() {
  if (!contractorDatabaseConfigured()) return [];
  await ensureContractorSchema();
  const sql = contractorSql();
  const rows = await sql`
    SELECT id, display_name, email, status, created_at, updated_at, deactivated_at
    FROM contractor_accounts
    ORDER BY created_at DESC
  ` as ContractorAccountRow[];
  return rows.map(rowToAccount);
}

export async function createContractorAccount(
  input: CreateContractorAccountInput,
): Promise<ContractorAccountResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();

  const displayName = sanitizeRequired(input.displayName, "Name", 120);
  const email = normalizeEmail(input.email);
  const password = input.temporaryPassword.trim();
  if (!displayName.ok) return displayName;
  if (!email) return { ok: false, status: 400, message: "A valid email is required." };
  if (!passwordMeetsContractorPolicy(password)) {
    return { ok: false, status: 400, message: "Temporary password must be at least 12 characters." };
  }

  const now = new Date().toISOString();
  const id = `ctr_${randomUUID()}`;
  const sql = contractorSql();
  try {
    const rows = await sql`
      INSERT INTO contractor_accounts (
        id, display_name, email, email_normalized, password_hash, status, created_at, updated_at
      )
      VALUES (
        ${id}, ${displayName.value}, ${input.email.trim()}, ${email},
        ${hashContractorPassword(password)}, ${CONTRACTOR_STATUS_ACTIVE}, ${now}, ${now}
      )
      RETURNING id, display_name, email, status, created_at, updated_at, deactivated_at
    ` as ContractorAccountRow[];
    await recordContractorAudit(id, "CONTRACTOR_INVITED", input.invitedBy);
    return { ok: true, account: rowToAccount(rows[0]) };
  } catch (error) {
    if (String(error).toLowerCase().includes("duplicate")) {
      return { ok: false, status: 409, message: "A contractor account already exists for that email." };
    }
    throw error;
  }
}

export async function deactivateContractorAccount(
  contractorId: string,
  deactivatedBy: string,
): Promise<ContractorAccountResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();
  const sql = contractorSql();
  const rows = await sql`
    UPDATE contractor_accounts
    SET status = ${CONTRACTOR_STATUS_DEACTIVATED}, deactivated_at = now(), updated_at = now()
    WHERE id = ${contractorId}
    RETURNING id, display_name, email, status, created_at, updated_at, deactivated_at
  ` as ContractorAccountRow[];
  const row = rows[0];
  if (!row) return { ok: false, status: 404, message: "Contractor account was not found." };
  await recordContractorAudit(contractorId, "CONTRACTOR_DEACTIVATED", deactivatedBy);
  return { ok: true, account: rowToAccount(row) };
}

export async function listAvailabilityForContractor(contractorId: string) {
  if (!contractorDatabaseConfigured()) return [];
  await ensureContractorSchema();
  const sql = contractorSql();
  const rows = await sql`
    SELECT
      ca.id, ca.contractor_id, c.display_name AS contractor_name, ca.availability_type,
      ca.day_of_week, ca.availability_date, ca.start_time, ca.end_time, ca.timezone,
      ca.status, ca.notes, ca.created_by, ca.created_at, ca.updated_at, ca.withdrawn_at
    FROM contractor_availability ca
    JOIN contractor_accounts c ON c.id = ca.contractor_id
    WHERE ca.contractor_id = ${contractorId}
    ORDER BY ca.status ASC, ca.availability_date NULLS FIRST, ca.day_of_week NULLS LAST, ca.start_time ASC
  ` as ContractorAvailabilityRow[];
  return rows.map(rowToAvailability);
}

export async function listAllContractorAvailability(filters: {
  contractorId?: string;
  availabilityType?: string;
} = {}) {
  if (!contractorDatabaseConfigured()) return [];
  await ensureContractorSchema();
  const sql = contractorSql();
  const rows = await sql`
    SELECT
      ca.id, ca.contractor_id, c.display_name AS contractor_name, ca.availability_type,
      ca.day_of_week, ca.availability_date, ca.start_time, ca.end_time, ca.timezone,
      ca.status, ca.notes, ca.created_by, ca.created_at, ca.updated_at, ca.withdrawn_at
    FROM contractor_availability ca
    JOIN contractor_accounts c ON c.id = ca.contractor_id
    WHERE (${filters.contractorId ?? ""} = '' OR ca.contractor_id = ${filters.contractorId ?? ""})
      AND (${filters.availabilityType ?? ""} = '' OR ca.availability_type = ${filters.availabilityType ?? ""})
    ORDER BY c.display_name ASC, ca.status ASC, ca.availability_date NULLS FIRST, ca.day_of_week NULLS LAST, ca.start_time ASC
  ` as ContractorAvailabilityRow[];
  return rows.map(rowToAvailability);
}

export async function listAssignmentsForOwner(leadId = "") {
  if (!contractorDatabaseConfigured()) return [];
  await ensureContractorSchema();
  const sql = contractorSql();
  const rows = await sql`
    SELECT
      ca.id, ca.lead_id, ca.contractor_id, c.display_name AS contractor_name,
      ca.status, ca.scheduled_start, ca.scheduled_end, ca.service_types, ca.city,
      ca.access_notes, ca.calendar_sync_status, ca.job_name, ca.required_crew_size,
      ca.travel_buffer_minutes, ca.travel_buffer_override, ca.proposed_by, ca.proposed_at,
      ca.approved_at, ca.approved_by, ca.rejected_at, ca.rejected_by, ca.canceled_at,
      ca.canceled_by, ca.conflict_flagged_at, ca.conflict_reason, ca.audit_trail,
      ca.created_at, ca.updated_at
    FROM contractor_assignments ca
    JOIN contractor_accounts c ON c.id = ca.contractor_id
    WHERE (${leadId} = '' OR ca.lead_id = ${leadId})
    ORDER BY ca.updated_at DESC
  ` as ContractorAssignmentRow[];
  return rows.map(rowToAssignment);
}

export async function listApprovedAssignmentsForContractor(contractorId: string) {
  if (!contractorDatabaseConfigured()) return [];
  await ensureContractorSchema();
  const sql = contractorSql();
  const rows = await sql`
    SELECT
      ca.id, ca.lead_id, ca.contractor_id, c.display_name AS contractor_name,
      ca.status, ca.scheduled_start, ca.scheduled_end, ca.service_types, ca.city,
      ca.access_notes, ca.calendar_sync_status, ca.job_name, ca.required_crew_size,
      ca.travel_buffer_minutes, ca.travel_buffer_override, ca.proposed_by, ca.proposed_at,
      ca.approved_at, ca.approved_by, ca.rejected_at, ca.rejected_by, ca.canceled_at,
      ca.canceled_by, ca.conflict_flagged_at, ca.conflict_reason, ca.audit_trail,
      ca.created_at, ca.updated_at
    FROM contractor_assignments ca
    JOIN contractor_accounts c ON c.id = ca.contractor_id
    WHERE ca.contractor_id = ${contractorId}
      AND ca.status IN (${ASSIGNMENT_STATUS_APPROVED}, ${ASSIGNMENT_STATUS_CONFLICT_REVIEW})
    ORDER BY ca.scheduled_start ASC
  ` as ContractorAssignmentRow[];
  return rows.map(rowToAssignment);
}

export async function getAssignmentCandidates(input: AssignmentProposalInput) {
  if (!contractorDatabaseConfigured()) return [];
  await ensureContractorSchema();
  const validation = validateAssignmentInput(input);
  if (!validation.ok) return [];
  return evaluateAssignmentCandidates(validation.value);
}

export async function saveAssignmentProposal(
  input: AssignmentProposalInput,
  actor: string,
): Promise<AssignmentProposalResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();
  const validation = validateAssignmentInput(input);
  if (!validation.ok) return validation;

  const candidates = await evaluateAssignmentCandidates(validation.value);
  const selected = candidates.filter((candidate) =>
    validation.value.contractorIds.includes(candidate.contractorId),
  );
  if (validation.value.contractorIds.length === 0) {
    return { ok: false, status: 400, message: "Choose at least one contractor.", candidates };
  }
  if (selected.length !== validation.value.contractorIds.length) {
    return { ok: false, status: 409, message: "One or more selected contractors are inactive or unavailable.", candidates };
  }
  if (selected.some((candidate) => candidate.conflict)) {
    return { ok: false, status: 409, message: "Resolve contractor conflicts before saving a proposal.", candidates };
  }

  const sql = contractorSql();
  const now = new Date().toISOString();
  for (const contractorId of validation.value.contractorIds) {
    const id = `asg_${randomUUID()}`;
    await sql`
      INSERT INTO contractor_assignments (
        id, lead_id, contractor_id, status, scheduled_start, scheduled_end,
        service_types, city, access_notes, calendar_sync_status, job_name,
        required_crew_size, travel_buffer_minutes, travel_buffer_override,
        proposed_by, proposed_at, audit_trail
      )
      VALUES (
        ${id}, ${validation.value.leadId}, ${contractorId}, ${ASSIGNMENT_STATUS_PROPOSED},
        ${validation.value.scheduledStart}, ${validation.value.scheduledEnd},
        ${validation.value.serviceTypes}, ${validation.value.city}, ${validation.value.accessNotes},
        'NOT_SYNCED', ${validation.value.jobName}, ${validation.value.requiredCrewSize},
        ${validation.value.travelBufferMinutes}, ${validation.value.travelBufferOverride},
        ${actor}, ${now}, ${assignmentAudit("", `${actor} proposed crew assignment.`, now)}
      )
      ON CONFLICT (lead_id, contractor_id) DO UPDATE
      SET status = ${ASSIGNMENT_STATUS_PROPOSED},
          scheduled_start = ${validation.value.scheduledStart},
          scheduled_end = ${validation.value.scheduledEnd},
          service_types = ${validation.value.serviceTypes},
          city = ${validation.value.city},
          access_notes = ${validation.value.accessNotes},
          job_name = ${validation.value.jobName},
          required_crew_size = ${validation.value.requiredCrewSize},
          travel_buffer_minutes = ${validation.value.travelBufferMinutes},
          travel_buffer_override = ${validation.value.travelBufferOverride},
          proposed_by = ${actor},
          proposed_at = ${now},
          approved_at = null,
          approved_by = '',
          rejected_at = null,
          rejected_by = '',
          canceled_at = null,
          canceled_by = '',
          conflict_flagged_at = null,
          conflict_reason = '',
          audit_trail = contractor_assignments.audit_trail || ${assignmentAudit("", `${actor} updated crew proposal.`, now)},
          updated_at = now()
    `;
  }
  const assignments = await listAssignmentsForOwner(validation.value.leadId);
  return { ok: true, assignments, candidates };
}

export async function approveAssignmentProposal(
  input: AssignmentProposalInput,
  actor: string,
): Promise<AssignmentDecisionResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();
  const validation = validateAssignmentInput(input);
  if (!validation.ok) return validation;

  const existing = await listAssignmentsForOwner(validation.value.leadId);
  const proposed = existing.filter((assignment) => assignment.status === ASSIGNMENT_STATUS_PROPOSED);
  if (proposed.length === 0) {
    return { ok: false, status: 400, message: "Save a proposal before approving assignments.", assignments: existing };
  }
  const proposedIds = proposed.map((assignment) => assignment.contractorId);
  const proposalForApproval = { ...validation.value, contractorIds: proposedIds };
  const candidates = await evaluateAssignmentCandidates(proposalForApproval);
  const selected = candidates.filter((candidate) => proposedIds.includes(candidate.contractorId));
  if (selected.length !== proposedIds.length) {
    return { ok: false, status: 409, message: "One or more proposed contractors are inactive.", assignments: existing, candidates };
  }
  if (selected.some((candidate) => candidate.conflict)) {
    return { ok: false, status: 409, message: "One or more proposed contractors are no longer available.", assignments: existing, candidates };
  }
  if (selected.length < validation.value.requiredCrewSize) {
    return { ok: false, status: 409, message: "Insufficient staffing for the required crew size.", assignments: existing, candidates };
  }

  const sql = contractorSql();
  const now = new Date().toISOString();
  await sql`
    UPDATE contractor_assignments
    SET status = ${ASSIGNMENT_STATUS_APPROVED},
        approved_at = COALESCE(approved_at, ${now}),
        approved_by = CASE WHEN approved_by = '' THEN ${actor} ELSE approved_by END,
        audit_trail = audit_trail || ${assignmentAudit("", `${actor} approved crew assignment.`, now)},
        updated_at = now()
    WHERE lead_id = ${validation.value.leadId}
      AND status = ${ASSIGNMENT_STATUS_PROPOSED}
  `;
  return { ok: true, assignments: await listAssignmentsForOwner(validation.value.leadId), candidates };
}

export async function rejectAssignmentProposal(leadId: string, actor: string) {
  return transitionAssignments(leadId, ASSIGNMENT_STATUS_PROPOSED, ASSIGNMENT_STATUS_REJECTED, actor, "rejected");
}

export async function cancelApprovedAssignments(leadId: string, actor: string) {
  return transitionAssignments(leadId, ASSIGNMENT_STATUS_APPROVED, ASSIGNMENT_STATUS_CANCELED, actor, "canceled");
}

export async function createContractorAvailability(
  input: ContractorAvailabilityInput,
  actor: { id: string; label: string; isOwner: boolean },
): Promise<ContractorAvailabilityResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();
  const validation = validateAvailabilityInput(input, actor);
  if (!validation.ok) return validation;

  const overlap = await findOverlappingAvailability(validation.value);
  if (overlap) {
    return { ok: false, status: 409, message: "This availability overlaps an existing active window." };
  }

  const id = `av_${randomUUID()}`;
  const sql = contractorSql();
  const rows = await sql`
    INSERT INTO contractor_availability (
      id, contractor_id, availability_type, day_of_week, availability_date,
      start_time, end_time, timezone, status, notes, created_by
    )
    VALUES (
      ${id}, ${validation.value.contractorId}, ${validation.value.availabilityType},
      ${validation.value.dayOfWeek}, ${validation.value.availabilityDate},
      ${validation.value.startTime}, ${validation.value.endTime}, ${validation.value.timezone},
      ${AVAILABILITY_STATUS_ACTIVE}, ${validation.value.notes}, ${actor.label}
    )
    RETURNING
      id, contractor_id, null AS contractor_name, availability_type, day_of_week,
      availability_date, start_time, end_time, timezone, status, notes, created_by,
      created_at, updated_at, withdrawn_at
  ` as ContractorAvailabilityRow[];
  await recordContractorAudit(validation.value.contractorId, "AVAILABILITY_CREATED", actor.label);
  return { ok: true, availability: await hydrateAvailability(rows[0]) };
}

export async function updateContractorAvailability(
  availabilityId: string,
  input: ContractorAvailabilityInput,
  actor: { id: string; label: string; isOwner: boolean },
): Promise<ContractorAvailabilityResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();
  const existing = await getAvailabilityById(availabilityId);
  if (!existing) return { ok: false, status: 404, message: "Availability was not found." };
  if (!actor.isOwner && existing.contractorId !== actor.id) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  const validation = validateAvailabilityInput(
    { ...input, contractorId: actor.isOwner ? input.contractorId ?? existing.contractorId : actor.id },
    actor,
  );
  if (!validation.ok) return validation;
  const overlap = await findOverlappingAvailability(validation.value, availabilityId);
  if (overlap) {
    return { ok: false, status: 409, message: "This availability overlaps an existing active window." };
  }

  const sql = contractorSql();
  const rows = await sql`
    UPDATE contractor_availability
    SET
      contractor_id = ${validation.value.contractorId},
      availability_type = ${validation.value.availabilityType},
      day_of_week = ${validation.value.dayOfWeek},
      availability_date = ${validation.value.availabilityDate},
      start_time = ${validation.value.startTime},
      end_time = ${validation.value.endTime},
      timezone = ${validation.value.timezone},
      notes = ${validation.value.notes},
      updated_at = now()
    WHERE id = ${availabilityId}
    RETURNING
      id, contractor_id, null AS contractor_name, availability_type, day_of_week,
      availability_date, start_time, end_time, timezone, status, notes, created_by,
      created_at, updated_at, withdrawn_at
  ` as ContractorAvailabilityRow[];
  await recordContractorAudit(validation.value.contractorId, "AVAILABILITY_UPDATED", actor.label);
  return { ok: true, availability: await hydrateAvailability(rows[0]) };
}

export async function withdrawContractorAvailability(
  availabilityId: string,
  actor: { id: string; label: string; isOwner: boolean },
): Promise<ContractorAvailabilityResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();
  const existing = await getAvailabilityById(availabilityId);
  if (!existing) return { ok: false, status: 404, message: "Availability was not found." };
  if (!actor.isOwner && existing.contractorId !== actor.id) {
    return { ok: false, status: 403, message: "Forbidden." };
  }
  const sql = contractorSql();
  const rows = await sql`
    UPDATE contractor_availability
    SET status = ${AVAILABILITY_STATUS_WITHDRAWN}, withdrawn_at = now(), updated_at = now()
    WHERE id = ${availabilityId}
    RETURNING
      id, contractor_id, null AS contractor_name, availability_type, day_of_week,
      availability_date, start_time, end_time, timezone, status, notes, created_by,
      created_at, updated_at, withdrawn_at
  ` as ContractorAvailabilityRow[];
  await flagAssignmentsAffectedByAvailability(existing, actor.label);
  await recordContractorAudit(existing.contractorId, "AVAILABILITY_WITHDRAWN", actor.label);
  return { ok: true, availability: await hydrateAvailability(rows[0]) };
}

let schemaReady = false;

export async function ensureContractorSchema() {
  if (schemaReady) return;
  const sql = contractorSql();
  await sql`
    CREATE TABLE IF NOT EXISTS contractor_accounts (
      id text PRIMARY KEY,
      display_name text NOT NULL,
      email text NOT NULL,
      email_normalized text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz,
      deactivated_at timestamptz
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS contractor_availability (
      id text PRIMARY KEY,
      contractor_id text NOT NULL REFERENCES contractor_accounts(id),
      availability_type text NOT NULL,
      day_of_week integer,
      availability_date date,
      start_time text NOT NULL,
      end_time text NOT NULL,
      timezone text NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      notes text NOT NULL DEFAULT '',
      created_by text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      withdrawn_at timestamptz
    )
  `;
  await sql`ALTER TABLE contractor_availability ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE contractor_availability ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS contractor_assignments (
      id text PRIMARY KEY,
      lead_id text NOT NULL,
      contractor_id text NOT NULL REFERENCES contractor_accounts(id),
      status text NOT NULL,
      scheduled_start timestamptz NOT NULL,
      scheduled_end timestamptz NOT NULL,
      service_types text NOT NULL DEFAULT '',
      city text NOT NULL DEFAULT '',
      access_notes text NOT NULL DEFAULT '',
      calendar_sync_status text NOT NULL DEFAULT 'NOT_SYNCED',
      job_name text NOT NULL DEFAULT '',
      required_crew_size integer NOT NULL DEFAULT 1,
      travel_buffer_minutes integer NOT NULL DEFAULT 30,
      travel_buffer_override boolean NOT NULL DEFAULT false,
      proposed_by text NOT NULL DEFAULT '',
      proposed_at timestamptz NOT NULL DEFAULT now(),
      approved_at timestamptz,
      approved_by text NOT NULL DEFAULT '',
      rejected_at timestamptz,
      rejected_by text NOT NULL DEFAULT '',
      canceled_at timestamptz,
      canceled_by text NOT NULL DEFAULT '',
      conflict_flagged_at timestamptz,
      conflict_reason text NOT NULL DEFAULT '',
      audit_trail text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (lead_id, contractor_id)
    )
  `;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS job_name text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS required_crew_size integer NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS travel_buffer_minutes integer NOT NULL DEFAULT 30`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS travel_buffer_override boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS proposed_by text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS proposed_at timestamptz NOT NULL DEFAULT now()`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS approved_at timestamptz`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS approved_by text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS rejected_at timestamptz`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS rejected_by text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS canceled_at timestamptz`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS canceled_by text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS conflict_flagged_at timestamptz`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS conflict_reason text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE contractor_assignments ADD COLUMN IF NOT EXISTS audit_trail text NOT NULL DEFAULT ''`;
  await sql`
    CREATE INDEX IF NOT EXISTS contractor_assignments_lead_status_idx
    ON contractor_assignments (lead_id, status)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS contractor_assignments_contractor_status_idx
    ON contractor_assignments (contractor_id, status)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS contractor_time_records (
      id text PRIMARY KEY,
      assignment_id text NOT NULL UNIQUE REFERENCES contractor_assignments(id),
      contractor_id text NOT NULL REFERENCES contractor_accounts(id),
      actual_start timestamptz NOT NULL,
      actual_end timestamptz NOT NULL,
      unpaid_break_minutes integer NOT NULL DEFAULT 0,
      calculated_hours numeric(8,2) NOT NULL,
      status text NOT NULL,
      submitted_at timestamptz NOT NULL DEFAULT now(),
      approved_at timestamptz,
      approved_by text,
      audit_trail text NOT NULL DEFAULT ''
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS contractor_audit_events (
      id text PRIMARY KEY,
      contractor_id text NOT NULL,
      action text NOT NULL,
      actor text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  schemaReady = true;
}

function contractorSql() {
  const databaseUrl = process.env.CONTRACTOR_DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error("CONTRACTOR_DATABASE_URL is not configured.");
  return neon(databaseUrl);
}

async function recordContractorAudit(contractorId: string, action: string, actor: string) {
  const sql = contractorSql();
  await sql`
    INSERT INTO contractor_audit_events (id, contractor_id, action, actor)
    VALUES (${randomUUID()}, ${contractorId}, ${action}, ${actor})
  `;
}

function rowToAccount(row: ContractorAccountRow): ContractorAccount {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    status:
      row.status === CONTRACTOR_STATUS_DEACTIVATED
        ? CONTRACTOR_STATUS_DEACTIVATED
        : CONTRACTOR_STATUS_ACTIVE,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
  };
}

async function getAvailabilityById(availabilityId: string) {
  const sql = contractorSql();
  const rows = await sql`
    SELECT
      ca.id, ca.contractor_id, c.display_name AS contractor_name, ca.availability_type,
      ca.day_of_week, ca.availability_date, ca.start_time, ca.end_time, ca.timezone,
      ca.status, ca.notes, ca.created_by, ca.created_at, ca.updated_at, ca.withdrawn_at
    FROM contractor_availability ca
    JOIN contractor_accounts c ON c.id = ca.contractor_id
    WHERE ca.id = ${availabilityId}
    LIMIT 1
  ` as ContractorAvailabilityRow[];
  return rows[0] ? rowToAvailability(rows[0]) : null;
}

async function findOverlappingAvailability(
  input: ValidatedAvailabilityInput,
  ignoredAvailabilityId = "",
) {
  const sql = contractorSql();
  const rows = await sql`
    SELECT id
    FROM contractor_availability
    WHERE contractor_id = ${input.contractorId}
      AND status = ${AVAILABILITY_STATUS_ACTIVE}
      AND (${ignoredAvailabilityId} = '' OR id != ${ignoredAvailabilityId})
      AND COALESCE(availability_date::text, '') = COALESCE(${input.availabilityDate}, '')
      AND COALESCE(day_of_week, -1) = COALESCE(${input.dayOfWeek}, -1)
      AND start_time < ${input.endTime}
      AND end_time > ${input.startTime}
    LIMIT 1
  ` as { id: string }[];
  return rows[0] ?? null;
}

async function hydrateAvailability(row: ContractorAvailabilityRow) {
  if (row.contractor_name) return rowToAvailability(row);
  const contractor = await getActiveOrAnyContractorAccount(row.contractor_id);
  return rowToAvailability({ ...row, contractor_name: contractor?.displayName ?? "Contractor" });
}

async function getActiveOrAnyContractorAccount(id: string) {
  const sql = contractorSql();
  const rows = await sql`
    SELECT id, display_name, email, status, created_at, updated_at, deactivated_at
    FROM contractor_accounts
    WHERE id = ${id}
    LIMIT 1
  ` as ContractorAccountRow[];
  return rows[0] ? rowToAccount(rows[0]) : null;
}

function rowToAvailability(row: ContractorAvailabilityRow): ContractorAvailability {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    contractorName: row.contractor_name ?? "Contractor",
    availabilityType: validAvailabilityType(row.availability_type)
      ? row.availability_type
      : AVAILABILITY_TYPE_REGULAR,
    dayOfWeek: row.day_of_week,
    availabilityDate: row.availability_date ? String(row.availability_date).slice(0, 10) : null,
    startTime: row.start_time,
    endTime: row.end_time,
    timezone: row.timezone,
    status:
      row.status === AVAILABILITY_STATUS_WITHDRAWN
        ? AVAILABILITY_STATUS_WITHDRAWN
        : AVAILABILITY_STATUS_ACTIVE,
    notes: row.notes,
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    withdrawnAt: row.withdrawn_at,
  };
}

function rowToAssignment(row: ContractorAssignmentRow): ContractorAssignment {
  return {
    assignmentId: row.id,
    leadId: row.lead_id,
    contractorId: row.contractor_id,
    contractorName: row.contractor_name ?? "Contractor",
    jobName: row.job_name,
    status: validAssignmentStatus(row.status) ? row.status : ASSIGNMENT_STATUS_PROPOSED,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    serviceTypes: row.service_types,
    city: row.city,
    accessNotes: row.access_notes,
    requiredCrewSize: Number(row.required_crew_size || 1),
    travelBufferMinutes: Number(row.travel_buffer_minutes || defaultTravelBufferMinutes()),
    travelBufferOverride: Boolean(row.travel_buffer_override),
    proposedBy: row.proposed_by,
    proposedAt: row.proposed_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    canceledBy: row.canceled_by,
    canceledAt: row.canceled_at,
    conflictFlaggedAt: row.conflict_flagged_at,
    conflictReason: row.conflict_reason,
    auditTrail: row.audit_trail,
    updatedAt: row.updated_at,
  };
}

type ValidatedAssignmentInput = {
  leadId: string;
  jobName: string;
  scheduledStart: string;
  scheduledEnd: string;
  serviceTypes: string;
  city: string;
  accessNotes: string;
  requiredCrewSize: number;
  contractorIds: string[];
  travelBufferMinutes: number;
  travelBufferOverride: boolean;
  note: string;
};

function validateAssignmentInput(
  input: AssignmentProposalInput,
): { ok: true; value: ValidatedAssignmentInput } | { ok: false; status: number; message: string } {
  const leadId = sanitizeOptional(input.leadId ?? "", 120);
  if (!leadId) return { ok: false, status: 400, message: "Job ID is required." };
  const scheduledStart = validIso(input.scheduledStart);
  const scheduledEnd = validIso(input.scheduledEnd);
  if (!scheduledStart || !scheduledEnd) {
    return { ok: false, status: 400, message: "Job start and end time are required." };
  }
  if (new Date(scheduledEnd).getTime() <= new Date(scheduledStart).getTime()) {
    return { ok: false, status: 400, message: "Job end time must be after start time." };
  }
  const requiredCrewSize = Math.max(1, Math.min(20, Math.floor(Number(input.requiredCrewSize || 1))));
  const travelBufferMinutes = Math.max(0, Math.min(240, Math.floor(Number(input.travelBufferMinutes ?? defaultTravelBufferMinutes()))));
  const contractorIds = Array.from(
    new Set((input.contractorIds ?? []).map((id) => sanitizeOptional(id, 120)).filter(Boolean)),
  );

  return {
    ok: true,
    value: {
      leadId,
      jobName: sanitizeOptional(input.jobName ?? "", 160),
      scheduledStart,
      scheduledEnd,
      serviceTypes: sanitizeOptional(input.serviceTypes ?? "", 240),
      city: sanitizeOptional(input.city ?? "", 120),
      accessNotes: sanitizeOptional(input.accessNotes ?? "", 300),
      requiredCrewSize,
      contractorIds,
      travelBufferMinutes,
      travelBufferOverride: Boolean(input.travelBufferOverride),
      note: sanitizeOptional(input.note ?? "", 500),
    },
  };
}

async function evaluateAssignmentCandidates(input: ValidatedAssignmentInput): Promise<AssignmentCandidate[]> {
  const accounts = (await listContractorAccounts()).filter(
    (account) => account.status === CONTRACTOR_STATUS_ACTIVE,
  );
  const jobStart = new Date(input.scheduledStart);
  const jobEnd = new Date(input.scheduledEnd);
  const bufferedStart = new Date(jobStart.getTime() - input.travelBufferMinutes * 60_000);
  const bufferedEnd = new Date(jobEnd.getTime() + input.travelBufferMinutes * 60_000);
  const jobDate = localDateValue(jobStart);
  const dayOfWeek = laDayOfWeek(jobStart);
  const sql = contractorSql();
  const existingRows = await sql`
    SELECT contractor_id
    FROM contractor_assignments
    WHERE status IN (${ASSIGNMENT_STATUS_APPROVED}, ${ASSIGNMENT_STATUS_CONFLICT_REVIEW})
      AND lead_id != ${input.leadId}
      AND scheduled_start < ${bufferedEnd.toISOString()}
      AND scheduled_end > ${bufferedStart.toISOString()}
  ` as { contractor_id: string }[];
  const assigned = new Set(existingRows.map((row) => row.contractor_id));

  const candidates: AssignmentCandidate[] = [];
  for (const account of accounts) {
    const availability = await listAvailabilityForContractor(account.id);
    const matching = availability.find((row) =>
      row.status === AVAILABILITY_STATUS_ACTIVE &&
      (row.availabilityDate === jobDate || (!row.availabilityDate && row.dayOfWeek === dayOfWeek)) &&
      windowContains(row, bufferedStart, bufferedEnd, jobDate)
    );
    const hasConflict = assigned.has(account.id);
    candidates.push({
      contractorId: account.id,
      contractorName: account.displayName,
      availabilityType: matching?.availabilityType ?? "NONE",
      available: Boolean(matching) && !hasConflict,
      onCall: matching?.availabilityType === AVAILABILITY_TYPE_ON_CALL,
      conflict: hasConflict || !matching,
      conflictReason: hasConflict
        ? "Already assigned to overlapping approved work."
        : matching
          ? ""
          : "No matching active availability for this job window.",
    });
  }
  return candidates;
}

function windowContains(
  row: ContractorAvailability,
  bufferedStart: Date,
  bufferedEnd: Date,
  jobDate: string,
) {
  const start = localTimeOnDateToUtc(jobDate, row.startTime);
  const end = localTimeOnDateToUtc(jobDate, row.endTime);
  if (!start || !end) return false;
  return start.getTime() <= bufferedStart.getTime() && end.getTime() >= bufferedEnd.getTime();
}

async function transitionAssignments(
  leadId: string,
  fromStatus: ContractorAssignmentStatus,
  toStatus: ContractorAssignmentStatus,
  actor: string,
  verb: "rejected" | "canceled",
): Promise<AssignmentDecisionResult> {
  if (!contractorDatabaseConfigured()) {
    return { ok: false, status: 503, message: "Contractor database is not configured." };
  }
  await ensureContractorSchema();
  const cleanedLeadId = sanitizeOptional(leadId, 120);
  if (!cleanedLeadId) return { ok: false, status: 400, message: "Job ID is required." };
  const existing = await listAssignmentsForOwner(cleanedLeadId);
  if (!existing.some((assignment) => assignment.status === fromStatus)) {
    return { ok: true, assignments: existing };
  }
  const now = new Date().toISOString();
  const sql = contractorSql();
  await sql`
    UPDATE contractor_assignments
    SET status = ${toStatus},
        rejected_at = CASE WHEN ${toStatus} = ${ASSIGNMENT_STATUS_REJECTED} THEN ${now} ELSE rejected_at END,
        rejected_by = CASE WHEN ${toStatus} = ${ASSIGNMENT_STATUS_REJECTED} THEN ${actor} ELSE rejected_by END,
        canceled_at = CASE WHEN ${toStatus} = ${ASSIGNMENT_STATUS_CANCELED} THEN ${now} ELSE canceled_at END,
        canceled_by = CASE WHEN ${toStatus} = ${ASSIGNMENT_STATUS_CANCELED} THEN ${actor} ELSE canceled_by END,
        audit_trail = audit_trail || ${assignmentAudit("", `${actor} ${verb} crew assignment.`, now)},
        updated_at = now()
    WHERE lead_id = ${cleanedLeadId} AND status = ${fromStatus}
  `;
  return { ok: true, assignments: await listAssignmentsForOwner(cleanedLeadId) };
}

async function flagAssignmentsAffectedByAvailability(
  availability: ContractorAvailability,
  actor: string,
) {
  const sql = contractorSql();
  const now = new Date().toISOString();
  const reason = "Availability was withdrawn after assignment approval.";
  if (availability.availabilityDate) {
    await sql`
      UPDATE contractor_assignments
      SET status = ${ASSIGNMENT_STATUS_CONFLICT_REVIEW},
          conflict_flagged_at = ${now},
          conflict_reason = ${reason},
          audit_trail = audit_trail || ${assignmentAudit("", `${actor} withdrew availability affecting approved assignment.`, now)},
          updated_at = now()
      WHERE contractor_id = ${availability.contractorId}
        AND status = ${ASSIGNMENT_STATUS_APPROVED}
        AND (scheduled_start AT TIME ZONE 'America/Los_Angeles')::date = ${availability.availabilityDate}::date
    `;
    return;
  }
  await sql`
    UPDATE contractor_assignments
    SET status = ${ASSIGNMENT_STATUS_CONFLICT_REVIEW},
        conflict_flagged_at = ${now},
        conflict_reason = ${reason},
        audit_trail = audit_trail || ${assignmentAudit("", `${actor} withdrew availability affecting approved assignment.`, now)},
        updated_at = now()
    WHERE contractor_id = ${availability.contractorId}
      AND status = ${ASSIGNMENT_STATUS_APPROVED}
      AND EXTRACT(DOW FROM scheduled_start AT TIME ZONE 'America/Los_Angeles') = ${availability.dayOfWeek ?? -1}
  `;
}

function validAssignmentStatus(value: string): value is ContractorAssignmentStatus {
  return [
    ASSIGNMENT_STATUS_PROPOSED,
    ASSIGNMENT_STATUS_APPROVED,
    ASSIGNMENT_STATUS_REJECTED,
    ASSIGNMENT_STATUS_CANCELED,
    ASSIGNMENT_STATUS_CONFLICT_REVIEW,
  ].includes(value as ContractorAssignmentStatus);
}

function validIso(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function defaultTravelBufferMinutes() {
  const value = Number(process.env.CONTRACTOR_TRAVEL_BUFFER_MINUTES || 30);
  return Number.isFinite(value) && value >= 0 ? Math.min(240, Math.floor(value)) : 30;
}

function assignmentAudit(existing: string, entry: string, timestamp: string) {
  return `${existing}${existing ? "\n" : ""}${timestamp} - ${entry}`;
}

function laDayOfWeek(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    weekday: "short",
    year: "numeric",
  }).formatToParts(date);
  const formatted = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${formatted.year}-${formatted.month}-${formatted.day}T12:00:00Z`).getUTCDay();
}

function localTimeOnDateToUtc(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = timezoneOffsetMs(utcGuess, "America/Los_Angeles");
  return new Date(utcGuess.getTime() - offset);
}

function timezoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

type ValidatedAvailabilityInput = Required<
  Pick<ContractorAvailabilityInput, "availabilityType" | "startTime" | "endTime" | "timezone" | "notes">
> & {
  contractorId: string;
  dayOfWeek: number | null;
  availabilityDate: string | null;
};

function validateAvailabilityInput(
  input: ContractorAvailabilityInput,
  actor: { id: string; isOwner: boolean },
): { ok: true; value: ValidatedAvailabilityInput } | { ok: false; status: number; message: string } {
  const contractorId = actor.isOwner ? input.contractorId?.trim() : actor.id;
  if (!contractorId) return { ok: false, status: 400, message: "Contractor is required." };
  if (!validAvailabilityType(input.availabilityType)) {
    return { ok: false, status: 400, message: "Availability type is invalid." };
  }
  if (
    !actor.isOwner &&
    input.availabilityType === AVAILABILITY_TYPE_DESIGNATED_SHIFT
  ) {
    return { ok: false, status: 403, message: "Only the owner can create designated shifts." };
  }

  const startTime = normalizeTime(input.startTime);
  const endTime = normalizeTime(input.endTime);
  if (!startTime || !endTime) {
    return { ok: false, status: 400, message: "Start and end times are required." };
  }
  if (minutesFromTime(endTime) <= minutesFromTime(startTime)) {
    return { ok: false, status: 400, message: "End time must be after start time." };
  }

  const availabilityDate = normalizeDate(input.availabilityDate ?? null);
  const dayOfWeek = Number.isInteger(input.dayOfWeek) ? Number(input.dayOfWeek) : null;
  if (availabilityDate && dayOfWeek !== null) {
    return { ok: false, status: 400, message: "Choose either a specific date or weekly day." };
  }
  if (!availabilityDate && (dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6)) {
    return { ok: false, status: 400, message: "Choose a valid weekly day or specific date." };
  }
  if (availabilityDate && availabilityDate < localDateValue(new Date())) {
    return { ok: false, status: 400, message: "Past dates are not available." };
  }

  return {
    ok: true,
    value: {
      contractorId,
      availabilityType: input.availabilityType,
      dayOfWeek,
      availabilityDate,
      startTime,
      endTime,
      timezone: "America/Los_Angeles",
      notes: sanitizeOptional(input.notes ?? "", 500),
    },
  };
}

function validAvailabilityType(value: string): value is ContractorAvailabilityType {
  return [
    AVAILABILITY_TYPE_REGULAR,
    AVAILABILITY_TYPE_ON_CALL,
    AVAILABILITY_TYPE_DESIGNATED_SHIFT,
    AVAILABILITY_TYPE_EXCEPTION,
  ].includes(value as ContractorAvailabilityType);
}

function normalizeTime(value: string) {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function localDateValue(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).format(date);
}

function sanitizeOptional(value: string, maxLength: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeEmail(email: string) {
  const trimmed = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : "";
}

function sanitizeRequired(value: string, label: string, maxLength: number) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: false as const, status: 400, message: `${label} is required.` };
  if (trimmed.length > maxLength) {
    return { ok: false as const, status: 400, message: `${label} is too long.` };
  }
  return { ok: true as const, value: trimmed };
}
