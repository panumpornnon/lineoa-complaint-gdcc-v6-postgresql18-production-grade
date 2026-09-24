-- ---------------------------------------------------------------------------
-- 033_staff_sessions.sql
-- บันทึกเซสชันการเข้าสู่ระบบของเจ้าหน้าที่ เพื่อให้เพิกถอนสิทธิ์ได้ทันที
--
-- เดิมระบบใช้ JWT แบบไม่เก็บสถานะ ออก token อายุ 8 ชั่วโมงแล้วจบ
-- ไม่มีที่ไหนบันทึกว่าใครกำลังใช้งานอยู่ ทำให้เกิดปัญหา 3 ข้อ
--   1. บัญชีเดียวล็อกอินพร้อมกันได้ไม่จำกัดเครื่อง และระบบตรวจจับไม่ได้
--   2. ปิดใช้งานบัญชีแล้วคนนั้นยังใช้งานต่อได้จนกว่า token จะหมดอายุ
--   3. เปลี่ยนรหัสผ่านแล้ว token เดิมที่คนอื่นถืออยู่ยังใช้ได้
--
-- ตารางนี้ทำให้ middleware ตรวจได้ทุกคำขอว่าเซสชันยังมีผลอยู่หรือไม่
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS staff_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT current_timestamp,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT current_timestamp,
  revoked_at timestamptz,
  -- superseded = ถูกแทนที่เพราะมีการเข้าสู่ระบบจากเครื่องใหม่
  -- account_disabled = บัญชีถูกปิดใช้งาน
  -- manual = ผู้ดูแลสั่งออกจากระบบ
  revoked_reason varchar(40),
  ip_address varchar(45),
  user_agent varchar(400)
);

-- ใช้ตอนเพิกถอนเซสชันเดิมทั้งหมดของผู้ใช้คนหนึ่งเมื่อมีการเข้าสู่ระบบใหม่
CREATE INDEX IF NOT EXISTS staff_sessions_active_by_user_idx
  ON staff_sessions (staff_user_id)
  WHERE revoked_at IS NULL;

-- ใช้ตอนล้างเซสชันที่หมดอายุแล้วออกจากตาราง
CREATE INDEX IF NOT EXISTS staff_sessions_expires_idx
  ON staff_sessions (expires_at);

COMMENT ON TABLE staff_sessions
  IS 'เซสชันการเข้าสู่ระบบของเจ้าหน้าที่ หนึ่งแถวต่อหนึ่งครั้งที่ล็อกอินสำเร็จ';

COMMIT;
