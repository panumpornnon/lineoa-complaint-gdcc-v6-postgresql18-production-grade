-- 008_exclusive_role.sql
-- เพิ่มบทบาท "exclusive": มองเห็นข้อมูลเท่ากับ admin ทุกหน้า/ทุก endpoint
-- แต่ไม่มีสิทธิ์แก้ไข/มอบหมาย/สร้าง/ลบข้อมูลใดๆ ทั้งสิ้น (read-only)

ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'exclusive';
