-- ---------------------------------------------------------------------------
-- 035_staff_email_and_password_reset.sql
-- เก็บอีเมลของเจ้าหน้าที่ และรองรับการตั้งรหัสผ่านใหม่ด้วยรหัสยืนยัน 8 หลัก
--
-- เดิมตาราง staff_users ไม่มีคอลัมน์อีเมล จึงไม่มีช่องทางติดต่อเจ้าของบัญชี
-- เมื่อลืมรหัสผ่าน ต้องให้ผู้ดูแลตั้งรหัสใหม่ให้อย่างเดียว
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS email varchar(254);

-- อีเมลต้องไม่ซ้ำกัน เพราะใช้เป็นช่องทางส่งรหัสยืนยัน
-- เทียบแบบไม่สนตัวพิมพ์ใหญ่เล็ก และยกเว้นแถวที่ยังไม่ได้กรอก
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_unique_idx
  ON staff_users (lower(email))
  WHERE email IS NOT NULL;

COMMENT ON COLUMN staff_users.email
  IS 'อีเมลของเจ้าหน้าที่ ใช้ส่งรหัสยืนยันเมื่อขอตั้งรหัสผ่านใหม่';

-- ---------------------------------------------------------------------------
-- รหัสยืนยันสำหรับตั้งรหัสผ่านใหม่
--
-- เก็บเป็นค่าแฮช ไม่เก็บรหัสตรงๆ ด้วยเหตุผลเดียวกับรหัสผ่าน
-- ผู้ที่อ่านฐานข้อมูลได้จึงยังนำรหัสไปใช้ไม่ได้
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  code_hash varchar(255) NOT NULL,
  expires_at timestamptz NOT NULL,
  -- นับจำนวนครั้งที่กรอกผิด เกินเกณฑ์แล้วรหัสใบนี้ใช้ไม่ได้อีก
  -- ป้องกันการไล่เดารหัสแปดหลักซึ่งมีความเป็นไปได้เพียงสิบล้านแบบ
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  -- ใครเป็นผู้ขอ ถ้าเป็น NULL แปลว่าเจ้าของบัญชีกดขอเองจากหน้าเข้าสู่ระบบ
  requested_by_staff_user_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  ip_address varchar(45),
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);

-- ใช้ตอนค้นรหัสที่ยังมีผลของผู้ใช้คนหนึ่ง และตอนยกเลิกใบเก่าเมื่อขอใบใหม่
CREATE INDEX IF NOT EXISTS password_reset_codes_active_idx
  ON password_reset_codes (staff_user_id)
  WHERE used_at IS NULL;

-- ใช้ตอนล้างรหัสที่หมดอายุแล้วออกจากตาราง
CREATE INDEX IF NOT EXISTS password_reset_codes_expires_idx
  ON password_reset_codes (expires_at);

COMMENT ON TABLE password_reset_codes
  IS 'รหัสยืนยัน 8 หลักสำหรับตั้งรหัสผ่านใหม่ เก็บเป็นค่าแฮช มีอายุจำกัดและจำกัดจำนวนครั้งที่กรอกผิด';

COMMIT;
