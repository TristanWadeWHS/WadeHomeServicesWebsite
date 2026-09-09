ALTER TABLE contractor_availability
  ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT '';

ALTER TABLE contractor_availability
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
