-- ---------------------------------------------------------------------------
-- 031_consolidate_personnel_categories.sql
-- รวมหมวดหมู่ของกองการเจ้าหน้าที่ให้เหลือชุดเดียว และให้ชุดนั้นมาจาก migration
--
-- ที่มาของปัญหา:
--   ฐานข้อมูล complaint_v6_development มีหมวดหมู่ของกองการเจ้าหน้าที่อยู่แล้ว
--   3 รายการ (JOB_RECUITMENT, REPORT_CORRUPTION, REPORT_ETHICS) ซึ่งถูกเพิ่ม
--   ผ่านหน้าเว็บ จึงมีอยู่เฉพาะในฐานข้อมูลนี้ ไม่ติดไปกับโค้ด
--   ต่อมาไฟล์ 029 เพิ่ม PERSONNEL_CORRUPTION และ PERSONNEL_RECRUITMENT เข้าไปอีก
--   ทำให้เกิดหมวดหมู่ความหมายซ้ำกันสองชุด
--
-- สิ่งที่ไฟล์นี้ทำ:
--   1. ประกาศหมวดหมู่ชุดที่ต้องการใช้จริง 3 รายการ ด้วยรหัสเดิมที่ใช้อยู่แล้ว
--      เพื่อให้ฐานข้อมูลใหม่ เช่น GDCC สร้างชุดนี้ขึ้นมาเองได้โดยไม่ต้องพิมพ์มือ
--   2. ย้ายเรื่องร้องเรียนที่ผูกกับหมวดหมู่ PERSONNEL_* ไปยังหมวดหมู่ปลายทาง
--   3. ลบหมวดหมู่ PERSONNEL_* ที่ไฟล์ 029 สร้างไว้
--
-- ไม่แก้ไฟล์ 029 โดยตรง เพราะถูก apply ไปแล้ว การแก้จะทำให้ checksum ไม่ตรง
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. หมวดหมู่ชุดที่ใช้จริง ผูกกับหน่วยงานรหัส PERSONNEL
--    ถ้ามีรหัสเหล่านี้อยู่แล้ว จะปรับชื่อ หน่วยงาน และลำดับให้ตรงกับไฟล์
-- ---------------------------------------------------------------------------
INSERT INTO complaint_categories (code, name_th, department_id, is_active, sort_order)
SELECT v.code, v.name_th, d.id, true, v.sort_order
  FROM (VALUES
          ('JOB_RECUITMENT',    'การรับสมัครพนักงาน',      80),
          ('REPORT_CORRUPTION', 'แจ้งการทุจริตเจ้าหน้าที่', 85),
          ('REPORT_ETHICS',     'แจ้งการฝ่าฝืนจริยธรรม',    90)
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

-- ---------------------------------------------------------------------------
-- 2. ย้ายเรื่องร้องเรียนที่ยังผูกกับหมวดหมู่ PERSONNEL_* ไปยังหมวดหมู่ปลายทาง
--    ต้องทำก่อนลบ มิฉะนั้น foreign key จะปฏิเสธการลบ
-- ---------------------------------------------------------------------------
UPDATE complaints AS c
   SET category_id = target.id
  FROM complaint_categories AS source,
       complaint_categories AS target
 WHERE c.category_id = source.id
   AND source.code = 'PERSONNEL_CORRUPTION'
   AND target.code = 'REPORT_CORRUPTION';

UPDATE complaints AS c
   SET category_id = target.id
  FROM complaint_categories AS source,
       complaint_categories AS target
 WHERE c.category_id = source.id
   AND source.code = 'PERSONNEL_RECRUITMENT'
   AND target.code = 'JOB_RECUITMENT';

-- ---------------------------------------------------------------------------
-- 3. ลบหมวดหมู่ชุดซ้ำที่ไฟล์ 029 สร้างไว้
-- ---------------------------------------------------------------------------
DELETE FROM complaint_categories
 WHERE code IN ('PERSONNEL_CORRUPTION', 'PERSONNEL_RECRUITMENT');

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. ตรวจสอบผลลัพธ์ ต้องเหลือ 3 แถว และต้องไม่มีรหัสขึ้นต้นด้วย PERSONNEL_
-- ---------------------------------------------------------------------------
SELECT c.code, c.name_th, c.sort_order, d.code AS department_code, d.name_th AS department_name
  FROM complaint_categories c
  LEFT JOIN departments d ON d.id = c.department_id
 WHERE c.code IN ('JOB_RECUITMENT', 'REPORT_CORRUPTION', 'REPORT_ETHICS')
    OR c.code LIKE 'PERSONNEL\_%'
 ORDER BY c.sort_order;
