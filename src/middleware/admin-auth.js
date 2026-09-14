import jwt from 'jsonwebtoken';
import config from '../config.js';
import { ApiError } from '../errors.js';

export function requireAdmin(req, res, next) {
  try {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw new ApiError(401, 'กรุณาเข้าสู่ระบบเจ้าหน้าที่');
    }

    const payload = jwt.verify(match[1], config.jwtSecret, {
      issuer: 'lineoa-complaint-gdcc',
      audience: 'complaint-admin',
    });

    req.admin = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      displayName: payload.displayName,
      departmentId: payload.departmentId ?? null,
    };

    return next();
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    return next(new ApiError(401, 'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'));
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
