CREATE TABLE IF NOT EXISTS staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(200) NOT NULL,
  line_id varchar(100),
  phone varchar(30),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT staff_profiles_line_id_not_blank
    CHECK (line_id IS NULL OR BTRIM(line_id) <> ''),
  CONSTRAINT staff_profiles_phone_not_blank
    CHECK (phone IS NULL OR BTRIM(phone) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_profiles_line_id_unique_idx
  ON staff_profiles (LOWER(line_id))
  WHERE line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS staff_profiles_phone_idx
  ON staff_profiles (phone)
  WHERE phone IS NOT NULL;

DROP TRIGGER IF EXISTS trg_staff_profiles_updated_at ON staff_profiles;
CREATE TRIGGER trg_staff_profiles_updated_at
BEFORE UPDATE ON staff_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
