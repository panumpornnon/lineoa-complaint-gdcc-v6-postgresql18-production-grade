ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS assigned_staff_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'complaints_assigned_staff_profile_id_fkey'
  ) THEN
    ALTER TABLE complaints
      ADD CONSTRAINT complaints_assigned_staff_profile_id_fkey
      FOREIGN KEY (assigned_staff_profile_id)
      REFERENCES staff_profiles(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS complaints_assigned_staff_profile_idx
  ON complaints (assigned_staff_profile_id, updated_at DESC);
