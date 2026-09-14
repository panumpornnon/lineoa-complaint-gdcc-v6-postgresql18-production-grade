BEGIN;

ALTER TABLE complaints
  ALTER COLUMN location_text DROP NOT NULL;

COMMIT;

SELECT
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'complaints'
  AND column_name = 'location_text';
