ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS job_name text NOT NULL DEFAULT '';

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS required_crew_size integer NOT NULL DEFAULT 1;

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS travel_buffer_minutes integer NOT NULL DEFAULT 30;

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS travel_buffer_override boolean NOT NULL DEFAULT false;

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS proposed_by text NOT NULL DEFAULT '';

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS approved_by text NOT NULL DEFAULT '';

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS rejected_by text NOT NULL DEFAULT '';

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz;

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS canceled_by text NOT NULL DEFAULT '';

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS conflict_flagged_at timestamptz;

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS conflict_reason text NOT NULL DEFAULT '';

ALTER TABLE contractor_assignments
  ADD COLUMN IF NOT EXISTS audit_trail text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS contractor_assignments_lead_status_idx
  ON contractor_assignments (lead_id, status);

CREATE INDEX IF NOT EXISTS contractor_assignments_contractor_status_idx
  ON contractor_assignments (contractor_id, status);
