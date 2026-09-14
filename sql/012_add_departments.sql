BEGIN;

INSERT INTO departments (code, name_th, is_active)
VALUES
  ('PUBLIC_HEALTH', 'กองสาธารณสุขและสิ่งแวดล้อม', true),
  ('TRAFFIC', 'งานเทศกิจและจราจร', true),
  ('DISASTER', 'งานป้องกันและบรรเทาสาธารณภัย', true),
  ('PUBLIC_WORKS', 'งานรักษาความสะอาด', true),
  ('CENTRAL', 'ศูนย์รับเรื่องและประสานงาน', true)
ON CONFLICT (code)
DO UPDATE SET
  name_th = EXCLUDED.name_th,
  is_active = true,
  updated_at = current_timestamp;

COMMIT;

SELECT
  id,
  code,
  name_th,
  is_active
FROM departments
WHERE code IN (
  'PUBLIC_HEALTH',
  'TRAFFIC',
  'DISASTER',
  'PUBLIC_WORKS',
  'CENTRAL'
)
ORDER BY code;