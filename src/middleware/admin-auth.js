import jwt from 'jsonwebtoken';
import config from '../config.js';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';

// อัปเดตเวลาใช้งานล่าสุดไม่ถี่กว่านี้ เพื่อไม่ให้ทุกคำขอกลายเป็นการเขียนฐานข้อมูล
const LAST_SEEN_REFRESH_MS = 60_000;

// อธิบายให้ผู้ใช้เข้าใจว่าทำไมถึงหลุดออกจากระบบ แทนข้อความกลางๆ ว่าเซสชันหมดอายุ
// ฝั่งหน้าเว็บใช้ค่า reason นี้ตัดสินว่าจะแสดงข้อความใดที่หน้าเข้าสู่ระบบ
const REVOKED_MESSAGES = {
  superseded: 'บัญชีนี้ถูกเข้าสู่ระบบจากอุปกรณ์อื่น ระบบอนุญาตให้ใช้งานได้ครั้งละหนึ่งเครื่องเท่านั้น',
  account_disabled: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  manual: 'ผู้ดูแลระบบสั่งให้บัญชีนี้ออกจากระบบ',
};

function sessionError(reason, message) {
  const error = new ApiError(401, message);
  error.sessionReason = reason;
  return error;
}

// ตรวจว่าเซสชันถูกยกเลิกไปด้วยเหตุใด เรียกเฉพาะตอนที่ตรวจหลักไม่ผ่าน
// จึงไม่เพิ่มภาระให้คำขอปกติ
async function explainInvalidSession(sessionId) {
  const result = await pool.query(
    `SELECT s.revoked_reason,
            s.revoked_at,
            s.expires_at <= current_timestamp AS is_expired,
            u.is_active
       FROM staff_sessions s
       JOIN staff_users u ON u.id = s.staff_user_id
      WHERE s.id = $1`,
    [sessionId],
  );

  const row = result.rows[0];
  if (!row) {
    return sessionError('not_found', 'เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  }
  if (!row.is_active) {
    return sessionError('account_disabled', REVOKED_MESSAGES.account_disabled);
  }
  if (row.revoked_at) {
    const reason = row.revoked_reason || 'manual';
    return sessionError(
      reason,
      REVOKED_MESSAGES[reason] || 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่',
    );
  }
  if (row.is_expired) {
    return sessionError('expired', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  return sessionError('unknown', 'เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
}

export async function requireAdmin(req, res, next) {
  let payload;

  try {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new ApiError(401, 'กรุณาเข้าสู่ระบบเจ้าหน้าที่');
    }

    payload = jwt.verify(match[1], config.jwtSecret, {
      issuer: 'lineoa-complaint-gdcc',
      audience: 'complaint-admin',
    });
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    return next(new ApiError(401, 'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'));
  }

  // token ที่ออกก่อนมีระบบเซสชันจะไม่มี jti จึงใช้ต่อไม่ได้
  // เป็นพฤติกรรมที่ต้องการ เพราะ token เหล่านั้นเพิกถอนไม่ได้
  const sessionId = payload.jti;
  if (!sessionId) {
    return next(
      sessionError('legacy_token', 'รูปแบบการเข้าสู่ระบบเปลี่ยนไป กรุณาเข้าสู่ระบบใหม่'),
    );
  }

  try {
    // คำสั่งเดียวตอบทั้งสามคำถาม: เซสชันยังมีผลไหม บัญชียังเปิดใช้งานไหม
    // และสิทธิ์ปัจจุบันคืออะไร โดยอ่านสิทธิ์จากฐานข้อมูลไม่ใช่จาก token
    // เพื่อให้การเปลี่ยนสิทธิ์หรือหน่วยงานมีผลทันทีโดยไม่ต้องรอ token หมดอายุ
    const result = await pool.query(
      `SELECT u.id,
              u.username,
              u.display_name,
              u.role,
              u.department_id,
              s.last_seen_at < current_timestamp - interval '1 minute' AS last_seen_stale
         FROM staff_sessions s
         JOIN staff_users u ON u.id = s.staff_user_id
        WHERE s.id = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > current_timestamp
          AND u.is_active`,
      [sessionId],
    );

    if (!result.rowCount) {
      return next(await explainInvalidSession(sessionId));
    }

    const user = result.rows[0];

    req.admin = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      departmentId: user.department_id ?? null,
      sessionId,
    };

    if (user.last_seen_stale) {
      await pool.query(
        `UPDATE staff_sessions
            SET last_seen_at = current_timestamp
          WHERE id = $1`,
        [sessionId],
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(new ApiError(403, 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการ'));
    }
    return next();
  };
}

// Officer เป็น role สิทธิ์ต่ำสุดในทีมงาน — helper นี้ตอบคำถาม
// "role ปัจจุบันอยู่เหนือ officer หรือไม่" ใช้เวลาต้องแยกว่า
// supervisor/admin ทำได้ไม่จำกัด แต่ officer ทำได้เฉพาะงานของตัวเอง
export function isElevatedStaff(admin) {
  return Boolean(admin) && ['admin', 'dev', 'supervisor'].includes(admin.role);
}
