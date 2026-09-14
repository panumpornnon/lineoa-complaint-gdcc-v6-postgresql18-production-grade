-- ---------------------------------------------------------------------------
-- 029_seed_personnel_department.sql
-- เพิ่มหน่วยงาน "กองการเจ้าหน้าที่" และหมวดหมู่เรื่องร้องเรียนที่หน่วยงานนี้รับผิดชอบ
--
-- เหตุผล: ข้อมูลหน่วยงานและหมวดหมู่เป็นข้อมูลอ้างอิงพื้นฐานของระบบ
--         ต้องอยู่ในไฟล์ migration เพื่อให้ทุกสภาพแวดล้อม (local / GDCC / สำรอง)
--         มีข้อมูลชุดเดียวกันเสมอ ไม่ต้องไปเพิ่มมือผ่านหน้าเว็บทีละเครื่อง
--
-- รันซ้ำได้ (idempotent) ด้วย ON CONFLICT (code)
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. หน่วยงาน
-- ---------------------------------------------------------------------------
INSERT INTO departments (code, name_th, is_active)
VALUES ('PERSONNEL', 'กองการเจ้าหน้าที่', true)
ON CONFLICT (code)
DO UPDATE SET
  name_th = EXCLUDED.name_th,
  is_active = true,
  updated_at = current_timestamp;

-- ---------------------------------------------------------------------------
-- 2. หมวดหมู่เรื่องร้องเรียน
--    อ้างอิงหน่วยงานด้วย code ไม่ใช่ uuid เพราะ uuid ของแต่ละฐานข้อมูลไม่ตรงกัน
--    sort_order 80 และ 85 เพื่อให้อยู่ก่อนหมวด "เรื่องอื่น ๆ" ที่ใช้ 100
-- ---------------------------------------------------------------------------
INSERT INTO complaint_categories (code, name_th, department_id, is_active, sort_order)
SELECT v.code, v.name_th, d.id, true, v.sort_order
  FROM (VALUES
          ('PERSONNEL_CORRUPTION', 'แจ้งการทุจริตเจ้าหน้าที่', 80),
          ('PERSONNEL_RECRUITMENT', 'รับสมัครพนักงาน', 85)
       ) AS v(code, name_th, sort_order)
  CROSS JOIN departments d
 WHERE d.code = 'PERSONNEL'
ON CONFLICT (code)
DO UPDATE SET
  name_th = EXCLUDED.name_th,
  department_id = EXCLUDED.department_id,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  updated_at = current_timestamp;

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. ตรวจสอบผลลัพธ์
-- ---------------------------------------------------------------------------
SELECT c.code, c.name_th, c.sort_order, c.sla_hours, d.code AS department_code, d.name_th AS department_name
  FROM complaint_categories c
  LEFT JOIN departments d ON d.id = c.department_id
 WHERE c.code IN ('PERSONNEL_CORRUPTION', 'PERSONNEL_RECRUITMENT')
 ORDER BY c.sort_order;
