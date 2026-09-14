-- Keep the production system limited to one DEV account.
DO $$
BEGIN
  IF (SELECT count(*) FROM staff_users WHERE role = 'dev'::staff_role) > 1 THEN
    RAISE EXCEPTION 'Cannot enforce single DEV account: more than one DEV account already exists';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_users_single_dev
  ON staff_users (role)
  WHERE role = 'dev'::staff_role;
