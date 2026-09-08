import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import {
  CONTRACTOR_STATUS_ACTIVE,
  CONTRACTOR_STATUS_DEACTIVATED,
  type ContractorAccount,
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

type CreateContractorAccountInput = {
  displayName: string;
  email: string;
  temporaryPassword: string;
  invitedBy: string;
};

export type ContractorAccountResult =
  | { ok: true; account: ContractorAccount }
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
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
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
