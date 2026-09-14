ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS position_title varchar(200);

UPDATE staff_profiles
   SET position_title = 'ไม่ระบุตำแหน่ง'
 WHERE position_title IS NULL
    OR BTRIM(position_title) = '';

ALTER TABLE staff_profiles
  ALTER COLUMN position_title SET NOT NULL;

ALTER TABLE staff_profiles
  DROP CONSTRAINT IF EXISTS staff_profiles_position_title_not_blank;

ALTER TABLE staff_profiles
  ADD CONSTRAINT staff_profiles_position_title_not_blank
  CHECK (BTRIM(position_title) <> '');

