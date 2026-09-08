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
);

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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS contractor_audit_events (
  id text PRIMARY KEY,
  contractor_id text NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
