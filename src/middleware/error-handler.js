import multer from 'multer';
import { ApiError } from '../errors.js';
import config from '../config.js';
import { logger } from '../logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: 'ไม่พบเส้นทางที่ร้องขอ',
    requestId: req.requestId,
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `อัปโหลดไม่สำเร็จ: รูปภาพแต่ละไฟล์ต้องไม่เกิน ${config.maxUploadMb} MB`,
      LIMIT_FILE_COUNT: `อัปโหลดไม่สำเร็จ: แนบรูปภาพได้ไม่เกิน ${config.maxUploadFiles} ภาพ`,
      LIMIT_UNEXPECTED_FILE: `อัปโหลดไม่สำเร็จ: แนบรูปภาพได้ไม่เกิน ${config.maxUploadFiles} ภาพ`,
      LIMIT_FIELD_COUNT: 'อัปโหลดไม่สำเร็จ: แบบฟอร์มมีจำนวนช่องมากเกินกำหนด',
    };
    return res.status(400).json({ success: false, message: messages[error.code] || 'ไม่สามารถรับไฟล์ที่อัปโหลดได้', requestId: req.requestId });
  }

  if (error instanceof ApiError) {
    return res.status(error.status).json({ success: false, message: error.message, ...(error.details ? { details: error.details } : {}), requestId: req.requestId });
  }

  if (error?.code === '23505') {
    return res.status(409).json({ success: false, message: 'ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว', requestId: req.requestId });
  }

  logger.error('unhandled_request_error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    error: error.message,
    stack: error.stack,
  });

  return res.status(500).json({
    success: false,
    message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    requestId: req.requestId,
    ...(!config.isProduction ? { error: error.message, stack: error.stack } : {}),
  });
}
