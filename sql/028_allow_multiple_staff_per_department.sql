-- 028_allow_multiple_staff_per_department.sql
-- ยกเลิกข้อจำกัด "หนึ่งหน่วยงานมี Officer / Supervisor ที่เปิดใช้งานได้ไม่เกิน 1 คน"
-- ที่สร้างไว้ใน 010_department_single_role.sql
--
-- เหตุผล: หน่วยงานจริงมีเจ้าหน้าที่และหัวหน้าได้มากกว่าหนึ่งคน
-- ข้อจำกัดเดิมทำให้เพิ่มบัญชีคนที่สองในหน่วยงานเดียวกันไม่ได้
--
-- หมายเหตุ: ห้ามแก้ไฟล์ 010 ย้อนหลัง เพราะตัวรัน migration ตรวจ checksum
-- ของไฟล์ที่รันไปแล้ว หากไม่ตรงจะหยุดทำงานทั้งชุด

BEGIN;

DROP INDEX IF EXISTS staff_users_one_active_officer_per_department_idx;
DROP INDEX IF EXISTS staff_users_one_active_supervisor_per_department_idx;

COMMIT;
