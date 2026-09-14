ALTER TABLE complaint_attachments
  ADD COLUMN IF NOT EXISTS work_phase varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'complaint_attachments_work_phase_check'
  ) THEN
    ALTER TABLE complaint_attachments
      ADD CONSTRAINT complaint_attachments_work_phase_check
      CHECK (work_phase IS NULL OR work_phase IN ('in_progress', 'completed'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS complaint_attachments_work_phase_idx
  ON complaint_attachments (complaint_id, work_phase, created_at);
