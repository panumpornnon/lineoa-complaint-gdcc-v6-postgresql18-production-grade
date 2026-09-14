-- 007_workflow_alignment.sql
-- ปรับฐานข้อมูลให้รองรับ Workflow:
-- รับเรื่อง -> จัดหมวดหมู่ -> มอบหมาย Supervisor/Officer -> ดำเนินงาน
-- -> ส่งตรวจ -> Supervisor อนุมัติ/ตีกลับ -> ปิดงาน -> แจ้ง LINE

-- เพิ่มสถานะใหม่แบบ idempotent
ALTER TYPE complaint_status ADD VALUE IF NOT EXISTS 'submitted_for_review';
ALTER TYPE complaint_status ADD VALUE IF NOT EXISTS 'revision_required';
ALTER TYPE complaint_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE complaint_status ADD VALUE IF NOT EXISTS 'closed';

BEGIN;

-- =========================================================
-- 1) LINE users: แยกข้อมูลผู้ใช้ LINE ออกจาก complaints
-- =========================================================
CREATE TABLE IF NOT EXISTS line_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id varchar(64) NOT NULL UNIQUE,
  display_name varchar(255),
  picture_url text,
  is_following boolean NOT NULL DEFAULT true,
  followed_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp
);

INSERT INTO line_users (line_user_id, display_name, created_at, updated_at)
SELECT DISTINCT ON (c.line_user_id)
  c.line_user_id,
  c.line_display_name,
  c.created_at,
  c.updated_at
FROM complaints c
ORDER BY c.line_user_id, c.updated_at DESC
ON CONFLICT (line_user_id) DO UPDATE
SET display_name = COALESCE(EXCLUDED.display_name, line_users.display_name),
    updated_at = GREATEST(line_users.updated_at, EXCLUDED.updated_at);

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS line_user_record_id uuid REFERENCES line_users(id),
  ADD COLUMN IF NOT EXISTS category_source varchar(20) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS category_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS category_matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS category_confirmed_by uuid REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS assigned_supervisor_id uuid REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS submitted_for_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_note text;

UPDATE complaints c
SET line_user_record_id = lu.id
FROM line_users lu
WHERE c.line_user_record_id IS NULL
  AND lu.line_user_id = c.line_user_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'complaints_category_source_check'
  ) THEN
    ALTER TABLE complaints
      ADD CONSTRAINT complaints_category_source_check
      CHECK (category_source IN ('user', 'keyword', 'ai', 'staff', 'system'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'complaints_category_confidence_check'
  ) THEN
    ALTER TABLE complaints
      ADD CONSTRAINT complaints_category_confidence_check
      CHECK (category_confidence IS NULL OR category_confidence BETWEEN 0 AND 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS complaints_line_user_record_idx
  ON complaints (line_user_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_supervisor_idx
  ON complaints (assigned_supervisor_id, created_at DESC);

-- =========================================================
-- 2) Keyword / routing rules สำหรับจัดหมวดหมู่และมอบหมายอัตโนมัติ
-- =========================================================
CREATE TABLE IF NOT EXISTS category_keywords (
  id bigserial PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES complaint_categories(id) ON DELETE CASCADE,
  keyword varchar(200) NOT NULL,
  weight numeric(8,3) NOT NULL DEFAULT 1 CHECK (weight > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (category_id, keyword)
);

CREATE INDEX IF NOT EXISTS category_keywords_lookup_idx
  ON category_keywords (keyword)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS category_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES complaint_categories(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id),
  supervisor_id uuid REFERENCES staff_users(id),
  default_officer_id uuid REFERENCES staff_users(id),
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (category_id, department_id, priority)
);

CREATE INDEX IF NOT EXISTS category_routing_active_idx
  ON category_routing_rules (category_id, priority)
  WHERE is_active = true;

-- =========================================================
-- 3) ประวัติการมอบหมาย Supervisor / Officer
-- =========================================================
CREATE TABLE IF NOT EXISTS complaint_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  staff_user_id uuid NOT NULL REFERENCES staff_users(id),
  assignment_role staff_role NOT NULL,
  assigned_by uuid REFERENCES staff_users(id),
  assignment_source varchar(20) NOT NULL DEFAULT 'manual',
  assigned_at timestamptz NOT NULL DEFAULT current_timestamp,
  unassigned_at timestamptz,
  note text,
  CONSTRAINT complaint_assignments_role_check
    CHECK (assignment_role IN ('officer', 'supervisor')),
  CONSTRAINT complaint_assignments_source_check
    CHECK (assignment_source IN ('manual', 'rule', 'system')),
  CONSTRAINT complaint_assignments_time_check
    CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS complaint_one_active_assignment_per_role_idx
  ON complaint_assignments (complaint_id, assignment_role)
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS complaint_assignments_staff_idx
  ON complaint_assignments (staff_user_id, assigned_at DESC);

-- ย้ายข้อมูล Officer เดิมเข้าประวัติการมอบหมาย
INSERT INTO complaint_assignments (
  complaint_id, staff_user_id, assignment_role, assignment_source, assigned_at
)
SELECT c.id, c.assigned_staff_user_id, 'officer'::staff_role, 'system', c.updated_at
FROM complaints c
WHERE c.assigned_staff_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ย้ายข้อมูล Supervisor ที่มีอยู่ (ถ้ารันไฟล์นี้ซ้ำ)
INSERT INTO complaint_assignments (
  complaint_id, staff_user_id, assignment_role, assignment_source, assigned_at
)
SELECT c.id, c.assigned_supervisor_id, 'supervisor'::staff_role, 'system', c.updated_at
FROM complaints c
WHERE c.assigned_supervisor_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- =========================================================
-- 4) Tasks: งานที่ Officer ต้องดำเนินการ
-- =========================================================
CREATE TABLE IF NOT EXISTS complaint_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  officer_id uuid NOT NULL REFERENCES staff_users(id),
  supervisor_id uuid REFERENCES staff_users(id),
  title varchar(200) NOT NULL,
  detail text,
  status varchar(30) NOT NULL DEFAULT 'assigned',
  assigned_at timestamptz NOT NULL DEFAULT current_timestamp,
  started_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  completed_at timestamptz,
  due_at timestamptz,
  result_note text,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT complaint_tasks_status_check CHECK (
    status IN ('assigned', 'in_progress', 'waiting_for_info',
               'submitted_for_review', 'revision_required',
               'approved', 'completed', 'cancelled')
  ),
  CONSTRAINT complaint_tasks_due_check
    CHECK (due_at IS NULL OR due_at >= assigned_at)
);

CREATE INDEX IF NOT EXISTS complaint_tasks_complaint_idx
  ON complaint_tasks (complaint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS complaint_tasks_officer_status_idx
  ON complaint_tasks (officer_id, status, due_at);
CREATE INDEX IF NOT EXISTS complaint_tasks_supervisor_status_idx
  ON complaint_tasks (supervisor_id, status, submitted_at);

-- =========================================================
-- 5) Supervisor review: อนุมัติหรือตีกลับ
-- =========================================================
CREATE TABLE IF NOT EXISTS complaint_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES complaint_tasks(id) ON DELETE RESTRICT,
  supervisor_id uuid NOT NULL REFERENCES staff_users(id),
  result varchar(30) NOT NULL,
  note text,
  reviewed_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT complaint_reviews_result_check
    CHECK (result IN ('approved', 'revision_required', 'rejected'))
);

CREATE INDEX IF NOT EXISTS complaint_reviews_complaint_idx
  ON complaint_reviews (complaint_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS complaint_reviews_task_idx
  ON complaint_reviews (task_id, reviewed_at DESC)
  WHERE task_id IS NOT NULL;

-- =========================================================
-- 6) LINE notification outbox + retry
-- =========================================================
CREATE TABLE IF NOT EXISTS line_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  line_user_id varchar(64) NOT NULL,
  notification_type varchar(50) NOT NULL,
  status_snapshot complaint_status,
  message text NOT NULL,
  send_status varchar(20) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id varchar(150),
  error_message text,
  idempotency_key varchar(150) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT line_notifications_type_check CHECK (
    notification_type IN (
      'received', 'assigned', 'in_progress', 'waiting_for_info',
      'submitted_for_review', 'revision_required', 'completed', 'closed', 'custom'
    )
  ),
  CONSTRAINT line_notifications_send_status_check CHECK (
    send_status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')
  ),
  CONSTRAINT line_notifications_sent_check CHECK (
    (send_status = 'sent' AND sent_at IS NOT NULL)
    OR send_status <> 'sent'
  )
);

CREATE INDEX IF NOT EXISTS line_notifications_queue_idx
  ON line_notifications (send_status, next_attempt_at, created_at)
  WHERE send_status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS line_notifications_complaint_idx
  ON line_notifications (complaint_id, created_at DESC);

-- =========================================================
-- 7) ฟังก์ชัน updated_at มาตรฐาน
-- =========================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = current_timestamp;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_line_users_updated_at ON line_users;
CREATE TRIGGER trg_line_users_updated_at
BEFORE UPDATE ON line_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_category_routing_rules_updated_at ON category_routing_rules;
CREATE TRIGGER trg_category_routing_rules_updated_at
BEFORE UPDATE ON category_routing_rules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_complaint_tasks_updated_at ON complaint_tasks;
CREATE TRIGGER trg_complaint_tasks_updated_at
BEFORE UPDATE ON complaint_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_line_notifications_updated_at ON line_notifications;
CREATE TRIGGER trg_line_notifications_updated_at
BEFORE UPDATE ON line_notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- เติม trigger ให้ตารางเดิมด้วย
DROP TRIGGER IF EXISTS trg_complaints_updated_at ON complaints;
CREATE TRIGGER trg_complaints_updated_at
BEFORE UPDATE ON complaints
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_staff_users_updated_at ON staff_users;
CREATE TRIGGER trg_staff_users_updated_at
BEFORE UPDATE ON staff_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_complaint_categories_updated_at ON complaint_categories;
CREATE TRIGGER trg_complaint_categories_updated_at
BEFORE UPDATE ON complaint_categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_departments_updated_at ON departments;
CREATE TRIGGER trg_departments_updated_at
BEFORE UPDATE ON departments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
