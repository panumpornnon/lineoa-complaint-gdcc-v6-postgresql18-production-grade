BEGIN;

-- Fresh installations need this column before
-- 010_department_single_role.sql creates its partial unique indexes.
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);

CREATE INDEX IF NOT EXISTS staff_users_department_idx
  ON staff_users (department_id)
  WHERE department_id IS NOT NULL;

COMMIT;
