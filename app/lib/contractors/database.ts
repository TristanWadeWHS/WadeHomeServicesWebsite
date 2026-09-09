import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import {
  AVAILABILITY_STATUS_ACTIVE,
  AVAILABILITY_STATUS_WITHDRAWN,
  AVAILABILITY_TYPE_DESIGNATED_SHIFT,
  AVAILABILITY_TYPE_EXCEPTION,
  AVAILABILITY_TYPE_ON_CALL,
  AVAILABILITY_TYPE_REGULAR,
  CONTRACTOR_STATUS_ACTIVE,
  CONTRACTOR_STATUS_DEACTIVATED,
  type ContractorAccount,
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
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (lead_id, contractor_id)
    )
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
