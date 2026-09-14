BEGIN;

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(50) NOT NULL UNIQUE,
  name_th varchar(200) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS assigned_staff_user_id uuid REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS priority varchar(20) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS complaints_department_idx ON complaints (department_id, created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_assigned_staff_idx ON complaints (assigned_staff_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_due_idx ON complaints (due_at) WHERE due_at IS NOT NULL;

INSERT INTO departments (code, name_th) VALUES
  ('CENTRAL', 'ศูนย์รับเรื่องและประสานงาน'),
  ('ENGINEERING', 'กองช่าง'),
  ('PUBLIC_HEALTH', 'กองสาธารณสุขและสิ่งแวดล้อม'),
  ('PUBLIC_WORKS', 'งานรักษาความสะอาด'),
  ('DISASTER', 'งานป้องกันและบรรเทาสาธารณภัย'),
  ('TRAFFIC', 'งานเทศกิจและจราจร')
ON CONFLICT (code) DO NOTHING;

COMMIT;
