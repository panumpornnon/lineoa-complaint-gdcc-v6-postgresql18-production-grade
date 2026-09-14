BEGIN;

-- ตรวจสอบข้อมูลซ้ำก่อนสร้างข้อจำกัด
DO $$
DECLARE
  duplicate_record RECORD;
BEGIN
  SELECT
    department_id,
    role,
    COUNT(*) AS total
  INTO duplicate_record
  FROM staff_users
  WHERE department_id IS NOT NULL
    AND role IN ('officer', 'supervisor')
    AND is_active = TRUE
  GROUP BY department_id, role
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'พบผู้ใช้งานซ้ำในหน่วยงาน department_id=% role=% จำนวน=%',
      duplicate_record.department_id,
      duplicate_record.role,
      duplicate_record.total;
  END IF;
END
$$;

-- หนึ่งหน่วยงานมี Officer ที่เปิดใช้งานได้ไม่เกิน 1 คน
CREATE UNIQUE INDEX IF NOT EXISTS
  staff_users_one_active_officer_per_department_idx
ON staff_users (department_id)
WHERE department_id IS NOT NULL
  AND role = 'officer'
  AND is_active = TRUE;

-- หนึ่งหน่วยงานมี Supervisor ที่เปิดใช้งานได้ไม่เกิน 1 คน
CREATE UNIQUE INDEX IF NOT EXISTS
  staff_users_one_active_supervisor_per_department_idx
ON staff_users (department_id)
WHERE department_id IS NOT NULL
  AND role = 'supervisor'
  AND is_active = TRUE;

COMMIT;