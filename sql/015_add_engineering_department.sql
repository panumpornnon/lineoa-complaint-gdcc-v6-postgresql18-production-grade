BEGIN;

INSERT INTO departments (code, name_th, is_active)
VALUES ('ENGINEERING', 'กองช่าง', true)
ON CONFLICT (code)
DO UPDATE SET
  name_th = EXCLUDED.name_th,
  is_active = true,
  updated_at = current_timestamp;

COMMIT;

SELECT id, code, name_th, is_active
FROM departments
WHERE code = 'ENGINEERING';
