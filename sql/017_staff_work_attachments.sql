ALTER TABLE complaint_attachments
  ADD COLUMN IF NOT EXISTS attachment_source varchar(20) NOT NULL DEFAULT 'citizen',
  ADD COLUMN IF NOT EXISTS created_by_staff_user_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_note varchar(500);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'complaint_attachments_source_check'
  ) THEN
    ALTER TABLE complaint_attachments
      ADD CONSTRAINT complaint_attachments_source_check
      CHECK (attachment_source IN ('citizen', 'staff'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS complaint_attachments_source_idx
  ON complaint_attachments (complaint_id, attachment_source, created_at);
