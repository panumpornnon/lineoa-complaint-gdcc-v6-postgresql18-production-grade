BEGIN;

-- Local development can create anonymous test complaints without persisting
-- a LINE identity. Production cannot enable DEV_BYPASS_LINE_AUTH.
ALTER TABLE complaints
  ALTER COLUMN line_user_id DROP NOT NULL;

COMMIT;
