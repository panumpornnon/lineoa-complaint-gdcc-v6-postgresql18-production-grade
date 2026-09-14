-- 007_category_department_routing.sql
-- เชื่อมหมวดหมู่เรื่องร้องเรียนกับหน่วยงานรับผิดชอบ
-- PostgreSQL / Render PostgreSQL
--
-- แนวทางทำงาน:
-- 1) เพิ่ม complaint_categories.department_id
-- 2) สร้าง Foreign Key ไปยัง departments.id
-- 3) กำหนดหน่วยงานเริ่มต้นให้หมวดหมู่เดิมตาม code
-- 4) เติม department_id ให้ complaints เดิมที่ยังไม่มีหน่วยงาน
--
-- หมายเหตุ:
-- ตรวจสอบรหัส departments.code และ complaint_categories.code
-- ให้ตรงกับข้อมูลจริงของระบบก่อนใช้งานบน Production

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. เพิ่มคอลัมน์หน่วยงานรับผิดชอบในหมวดหมู่
-- ---------------------------------------------------------------------------
ALTER TABLE complaint_categories
    ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN complaint_categories.department_id
    IS 'หน่วยงานเริ่มต้นที่รับผิดชอบเรื่องร้องเรียนในหมวดหมู่นี้';

-- ---------------------------------------------------------------------------
-- 2. เพิ่ม Foreign Key แบบ idempotent
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'complaint_categories_department_fk'
          AND conrelid = 'complaint_categories'::regclass
    ) THEN
        ALTER TABLE complaint_categories
            ADD CONSTRAINT complaint_categories_department_fk
            FOREIGN KEY (department_id)
            REFERENCES departments(id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS complaint_categories_department_idx
    ON complaint_categories (department_id)
    WHERE department_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. กำหนดเส้นทางหมวดหมู่ไปยังหน่วยงาน
--    แก้ code ด้านล่างให้ตรงกับข้อมูลจริงในตาราง departments
-- ---------------------------------------------------------------------------

-- ถนน / ไฟฟ้าสาธารณะ / ท่อระบายน้ำ -> กองช่าง
UPDATE complaint_categories AS category
SET department_id = department.id
FROM departments AS department
WHERE category.code IN ('ROAD', 'LIGHT', 'DRAIN')
  AND department.code = 'ENGINEERING'
  AND category.department_id IS DISTINCT FROM department.id;

-- ขยะและความสะอาด -> งานรักษาความสะอาดหรือกองสาธารณสุข
UPDATE complaint_categories AS category
SET department_id = department.id
FROM departments AS department
WHERE category.code = 'WASTE'
  AND department.code IN ('PUBLIC_WORKS', 'SANITATION')
  AND category.department_id IS NULL;

-- สาธารณสุข / สิ่งแวดล้อม -> กองสาธารณสุข
UPDATE complaint_categories AS category
SET department_id = department.id
FROM departments AS department
WHERE category.code IN ('PUBLIC_HEALTH', 'ENVIRONMENT')
  AND department.code = 'PUBLIC_HEALTH'
  AND category.department_id IS DISTINCT FROM department.id;

-- จราจร -> งานจราจร
UPDATE complaint_categories AS category
SET department_id = department.id
FROM departments AS department
WHERE category.code = 'TRAFFIC'
  AND department.code = 'TRAFFIC'
  AND category.department_id IS DISTINCT FROM department.id;

-- เรื่องอื่น ๆ -> ส่วนกลาง
UPDATE complaint_categories AS category
SET department_id = department.id
FROM departments AS department
WHERE category.code = 'OTHER'
  AND department.code IN ('CENTRAL', 'ADMINISTRATION')
  AND category.department_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. เติมหน่วยงานให้เรื่องร้องเรียนเดิมที่ยังไม่มี department_id
-- ---------------------------------------------------------------------------
UPDATE complaints AS complaint
SET department_id = category.department_id
FROM complaint_categories AS category
WHERE complaint.category_id = category.id
  AND complaint.department_id IS NULL
  AND category.department_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. ตรวจสอบหมวดหมู่ที่ยังไม่ได้กำหนดหน่วยงาน
--    Migration จะไม่ล้ม เพื่อให้ผู้ดูแลกำหนดผ่านหน้า Admin ภายหลังได้
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    unmapped_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO unmapped_count
    FROM complaint_categories
    WHERE department_id IS NULL;

    IF unmapped_count > 0 THEN
        RAISE NOTICE
            'พบหมวดหมู่ที่ยังไม่ได้กำหนดหน่วยงานจำนวน % รายการ กรุณาตรวจสอบด้วยคำสั่ง SELECT ด้านท้ายไฟล์',
            unmapped_count;
    END IF;
END
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- คำสั่งตรวจสอบหลังรัน Migration
-- ---------------------------------------------------------------------------
SELECT
    category.id,
    category.code,
    category.name_th AS category_name,
    category.department_id,
    department.code AS department_code,
    department.name_th AS department_name
FROM complaint_categories AS category
LEFT JOIN departments AS department
    ON department.id = category.department_id
ORDER BY category.sort_order NULLS LAST, category.name_th;

-- ตัวอย่าง Query สำหรับ Backend ตอนสร้างเรื่องร้องเรียน:
--
-- SELECT
--     category.id,
--     category.department_id,
--     category.sla_hours
-- FROM complaint_categories AS category
-- INNER JOIN departments AS department
--     ON department.id = category.department_id
--    AND department.is_active = TRUE
-- WHERE category.id = $1
--   AND category.is_active = TRUE;
