ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS department_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'staff_profiles_department_id_fkey'
  ) THEN
    ALTER TABLE staff_profiles
      ADD CONSTRAINT staff_profiles_department_id_fkey
      FOREIGN KEY (department_id)
      REFERENCES departments(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS staff_profiles_department_id_idx
  ON staff_profiles (department_id);

