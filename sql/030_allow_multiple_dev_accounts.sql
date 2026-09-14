-- ---------------------------------------------------------------------------
-- 030_allow_multiple_dev_accounts.sql
-- ยกเลิกข้อจำกัดที่ระบบอนุญาตให้มีบัญชี DEV ได้เพียง 1 บัญชี
--
-- เดิมไฟล์ 020_limit_single_dev.sql สร้าง partial unique index บนคอลัมน์ role
-- เฉพาะแถวที่ role = 'dev' ทำให้ฐานข้อมูลปฏิเสธการเพิ่มบัญชี DEV ตัวที่สอง
-- ด้วย error 23505 (duplicate key)
--
-- ไม่แก้ไฟล์ 020 โดยตรง เพราะไฟล์นั้นถูก apply ไปแล้วในหลายฐานข้อมูล
-- การแก้จะทำให้ checksum ใน schema_migrations ไม่ตรงและ migration ทั้งชุดหยุดทำงาน
-- ---------------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS uq_staff_users_single_dev;

COMMIT;

-- ตรวจสอบว่า index ถูกลบแล้ว (ต้องไม่มีแถวใดคืนมา)
SELECT indexname
  FROM pg_indexes
 WHERE tablename = 'staff_users'
   AND indexname = 'uq_staff_users_single_dev';
