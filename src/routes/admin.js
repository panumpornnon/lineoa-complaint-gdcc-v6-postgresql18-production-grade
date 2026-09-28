import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import config from '../config.js';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';
import { requireAdmin, requireRoles } from '../middleware/admin-auth.js';
import {
  adminLoginSchema,
  statusUpdateSchema,
  workProgressUpdateSchema,
} from '../validators.js';
import { notifyAssignmentChanged, notifyStatusChanged } from '../services/notifications.js';
import {
  cleanupStoredImageKeys,
  cleanupStoredImages,
  processAndStoreImages,
  sendStoredImage,
  uploadStaffWorkImages,
} from '../services/uploads.js';
import { escapeCsvField, toExcelText, parseCsv, unwrapExcelText } from '../utils/csv.js';

const router = Router();

function getAdminDepartmentId(req) {
  return req.admin?.departmentId ?? req.admin?.department_id ?? null;
}

function isSameDepartmentStaff(req, departmentId) {
  return (
    ['officer', 'supervisor'].includes(req.admin?.role) &&
    Boolean(getAdminDepartmentId(req)) &&
    departmentId === getAdminDepartmentId(req)
  );
}

function isGlobalReadOnlyRole(role) {
  return ['executive', 'exclusive'].includes(role);
}

function isSystemAdminRole(role) {
  return ['admin', 'dev'].includes(role);
}

function canReadAllDepartments(role) {
  return isSystemAdminRole(role) || isGlobalReadOnlyRole(role);
}

function getRequestedDepartmentId(req) {
  const parsed = z.string().uuid().optional().safeParse(req.query.departmentId);
  if (!parsed.success) {
    throw new ApiError(400, 'รหัสหน่วยงานไม่ถูกต้อง');
  }
  return parsed.data ?? null;
}


async function writeAudit(req, action, entityType, entityId = null, detail = {}, executor = pool) {
  await executor.query(
    `INSERT INTO audit_logs (actor_staff_user_id, action, entity_type, entity_id, detail, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [req.admin?.id || null, action, entityType, entityId, JSON.stringify(detail), req.ip || null, req.get('user-agent') || null],
  );
}

// แปลงค่า JWT_EXPIRES_IN เช่น 8h เป็นจำนวนวินาที ใช้ตั้ง expires_at ของเซสชัน
// ให้ตรงกับอายุของ token เสมอ จะได้ไม่มีกรณีที่อย่างหนึ่งหมดอายุก่อนอีกอย่าง
function sessionLifetimeSeconds() {
  const raw = String(config.jwtExpiresIn ?? '8h').trim();
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  const match = /^(\d+)\s*([smhd])$/i.exec(raw);
  if (!match) return 8 * 60 * 60;
  const units = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
  return Number.parseInt(match[1], 10) * units[match[2].toLowerCase()];
}

const allowedTransitions = {
  new: ['received', 'in_progress'],
  received: ['assigned', 'in_progress'],
  assigned: ['in_progress', 'completed'],
  in_progress: ['completed'],
  waiting_for_info: ['received', 'assigned', 'in_progress', 'completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

router.post('/login', async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  const result = await pool.query(
    `SELECT id, username, password_hash, display_name, role, department_id, is_active
       FROM staff_users
      WHERE lower(username) = lower($1)
      LIMIT 1`,
    [parsed.data.username],
  );

  const user = result.rows[0];
  if (!user || !user.is_active) {
    throw new ApiError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  const isValid = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!isValid) {
    throw new ApiError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  // ระบบอนุญาตให้ใช้งานได้ครั้งละหนึ่งเครื่องต่อหนึ่งบัญชี แบบผู้มาก่อนได้สิทธิ์
  // ถ้ามีเซสชันที่ยังใช้งานอยู่จริง จะปฏิเสธการเข้าสู่ระบบทันที
  //
  // "ยังใช้งานอยู่จริง" หมายถึงยังไม่ถูกยกเลิก ยังไม่หมดอายุ และมีความเคลื่อนไหว
  // ภายในเวลาที่กำหนด เซสชันที่เงียบเกินกำหนดถือว่าสิ้นสุดแล้ว จึงไม่กันคนอื่นเข้า
  const client = await pool.connect();
  let sessionId;

  try {
    await client.query('BEGIN');

    // ล็อกแถวเซสชันของบัญชีนี้ไว้ก่อน กันสองเครื่องกดเข้าสู่ระบบพร้อมกัน
    // แล้วต่างฝ่ายต่างเห็นว่าไม่มีเซสชันอยู่ จนสร้างเซสชันซ้อนกันสองอัน
    const activeResult = await client.query(
      `SELECT id,
              last_seen_at > current_timestamp - make_interval(mins => $2)
              AND (
                closing_at IS NULL
                OR closing_at > current_timestamp - make_interval(secs => $3)
              ) AS is_live
         FROM staff_sessions
        WHERE staff_user_id = $1
          AND revoked_at IS NULL
          AND expires_at > current_timestamp
          FOR UPDATE`,
      [user.id, config.sessionIdleMinutes, config.sessionClosingGraceSeconds],
    );

    if (activeResult.rows.some((row) => row.is_live)) {
      await client.query('ROLLBACK');
      const error = new ApiError(
        409,
        'บัญชีนี้กำลังถูกใช้งานอยู่ที่อุปกรณ์อื่น ระบบอนุญาตให้เข้าใช้งานได้ครั้งละหนึ่งเครื่องเท่านั้น',
      );
      error.sessionReason = 'already_active';
      throw error;
    }

    // เซสชันที่เงียบเกินกำหนดถือว่าสิ้นสุดแล้ว ปิดให้เรียบร้อยก่อนเปิดอันใหม่
    // จะได้ไม่มีแถวค้างสะสมและเห็นสาเหตุชัดเจนตอนตรวจย้อนหลัง
    if (activeResult.rowCount) {
      await client.query(
        `UPDATE staff_sessions
            SET revoked_at = current_timestamp,
                revoked_reason = CASE
                  WHEN closing_at IS NOT NULL THEN 'browser_closed'
                  ELSE 'idle_timeout'
                END
          WHERE staff_user_id = $1
            AND revoked_at IS NULL`,
        [user.id],
      );
    }

    const created = await client.query(
      `INSERT INTO staff_sessions (staff_user_id, expires_at, ip_address, user_agent)
       VALUES ($1, current_timestamp + make_interval(secs => $2), $3, $4)
    RETURNING id`,
      [
        user.id,
        sessionLifetimeSeconds(),
        (req.ip || '').slice(0, 45) || null,
        (req.get('user-agent') || '').slice(0, 400) || null,
      ],
    );
    sessionId = created.rows[0].id;

    await client.query(
      `UPDATE staff_users SET last_login_at = current_timestamp WHERE id = $1`,
      [user.id],
    );

    await client.query('COMMIT');
  } catch (error) {
    // กรณีปฏิเสธการเข้าสู่ระบบซ้อน เรา rollback ไปแล้ว การสั่งซ้ำจะไม่มีผลใดๆ
    // แต่ห่อ try ไว้เพื่อไม่ให้ข้อผิดพลาดตัวจริงถูกกลบด้วยข้อผิดพลาดของ rollback
    try {
      await client.query('ROLLBACK');
    } catch {
      // ไม่มีทรานแซกชันค้างอยู่แล้ว
    }
    throw error;
  } finally {
    client.release();
  }

  // ไม่ใส่ role กับ departmentId ไว้ใน token อีกต่อไป เพราะ middleware อ่านค่าจริง
  // จากฐานข้อมูลทุกคำขออยู่แล้ว การเก็บซ้ำไว้ใน token มีแต่จะทำให้ค่าล้าสมัย
  const token = jwt.sign(
    {
      username: user.username,
      displayName: user.display_name,
    },
    config.jwtSecret,
    {
      subject: user.id,
      jwtid: sessionId,
      issuer: 'lineoa-complaint-gdcc',
      audience: 'complaint-admin',
      expiresIn: config.jwtExpiresIn,
    },
  );

  // writeAudit อ่านผู้กระทำจาก req.admin ซึ่งเส้นทางนี้ยังไม่ผ่าน middleware
  // จึงตั้งค่าให้ก่อน (จะ spread req ไม่ได้ เพราะ req.ip และ req.get เป็นเมท็อดของ prototype)
  req.admin = { id: user.id };
  await writeAudit(req, 'auth.login', 'staff_user', user.id, {});

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        departmentId: user.department_id,
      },
    },
  });
});

// รับสัญญาณว่าเบราว์เซอร์กำลังปิด ส่งมาด้วย navigator.sendBeacon
//
// ต้องวางไว้ก่อน requireAdmin เพราะ sendBeacon ตั้งส่วนหัวของคำขอเองไม่ได้
// จึงแนบ token มาในเนื้อคำขอแทน แล้วตรวจลายเซ็นเองที่นี่
//
// ไม่ยกเลิกเซสชันทันที เพราะเหตุการณ์ pagehide เกิดตอนกดรีเฟรชด้วย
// เพียงทำเครื่องหมายเวลาไว้ แล้วให้คำขอถัดไปของเซสชันเดียวกันมาล้างทิ้ง
router.post('/session/closing', async (req, res) => {
  const parsed = z.object({ token: z.string().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) {
    // ไม่บอกรายละเอียด และตอบสำเร็จเสมอ เพราะฝั่งเบราว์เซอร์กำลังจะปิดอยู่แล้ว
    // ไม่มีใครรอรับคำตอบ และไม่ควรเปิดช่องให้ทดสอบ token จากภายนอก
    return res.json({ success: true });
  }

  try {
    const payload = jwt.verify(parsed.data.token, config.jwtSecret, {
      issuer: 'lineoa-complaint-gdcc',
      audience: 'complaint-admin',
    });

    if (payload.jti) {
      await pool.query(
        `UPDATE staff_sessions
            SET closing_at = current_timestamp
          WHERE id = $1
            AND revoked_at IS NULL`,
        [payload.jti],
      );
    }
  } catch {
    // token ไม่ถูกต้องหรือหมดอายุ ไม่ต้องทำอะไร
  }

  return res.json({ success: true });
});

router.use(requireAdmin);

router.get('/me', (req, res) => {
  res.json({ success: true, data: req.admin });
});

// ออกจากระบบ — ยกเลิกเซสชันปัจจุบันที่ฝั่งเซิร์ฟเวอร์จริง
//
// จำเป็นอย่างยิ่งเมื่อใช้นโยบาย "หนึ่งบัญชีหนึ่งเครื่อง แบบผู้มาก่อนได้สิทธิ์"
// เพราะถ้าการกดออกจากระบบเป็นแค่การลบ token ทิ้งจากเบราว์เซอร์
// เซสชันเดิมจะยังนับว่าใช้งานอยู่ แล้วเจ้าตัวจะเข้าสู่ระบบใหม่ไม่ได้ทันที
router.post('/logout', async (req, res) => {
  await pool.query(
    `UPDATE staff_sessions
        SET revoked_at = current_timestamp,
            revoked_reason = 'signed_out'
      WHERE id = $1
        AND revoked_at IS NULL`,
    [req.admin.sessionId],
  );

  await writeAudit(req, 'auth.logout', 'staff_user', req.admin.id, {});

  res.json({ success: true, message: 'ออกจากระบบเรียบร้อย' });
});

router.get('/attachments/:id', async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) throw new ApiError(400, 'รหัสรูปภาพไม่ถูกต้อง');

  const result = await pool.query(
    `SELECT
        a.id,
        a.storage_key,
        a.mime_type,
        c.department_id
       FROM complaint_attachments a
       JOIN complaints c ON c.id = a.complaint_id
      WHERE a.id = $1`,
    [req.params.id],
  );

  if (result.rowCount === 0) throw new ApiError(404, 'ไม่พบรูปภาพ');

  if (
    !canReadAllDepartments(req.admin.role) &&
    !isSameDepartmentStaff(req, result.rows[0].department_id)
  ) {
    throw new ApiError(403, 'ไม่มีสิทธิ์ดูรูปภาพของหน่วยงานอื่น');
  }

  return sendStoredImage(res, result.rows[0]);
});

router.get('/complaints', async (req, res) => {
  const querySchema = z.object({
    status: z.string().optional(),
    search: z.string().max(200).optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    categoryId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    mine: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(400, 'ตัวกรองไม่ถูกต้อง');
  }

  const { status, search, month, categoryId, departmentId: requestedDepartmentId, mine, page, limit } = parsed.data;
  const conditions = [];
  const values = [];

  if (canReadAllDepartments(req.admin.role)) {
    if (requestedDepartmentId) {
      values.push(requestedDepartmentId);
      conditions.push(`c.department_id = $${values.length}`);
    }
  } else {
    const departmentId = getAdminDepartmentId(req);

    if (!departmentId) {
      throw new ApiError(403, 'บัญชีนี้ยังไม่ได้กำหนดหน่วยงาน');
    }

    values.push(departmentId);
    conditions.push(`c.department_id = $${values.length}`);
  }

  const monthScopeWhere = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';
  const [monthResult, categoryResult] = await Promise.all([
    pool.query(
      `SELECT to_char(date_trunc('month', c.created_at), 'YYYY-MM') AS value
         FROM complaints c
         ${monthScopeWhere}
        GROUP BY date_trunc('month', c.created_at)
        ORDER BY date_trunc('month', c.created_at) DESC`,
      values,
    ),
    pool.query(
      `SELECT DISTINCT cc.id, cc.name_th AS name
         FROM complaints c
         JOIN complaint_categories cc ON cc.id = c.category_id
         ${monthScopeWhere}
        ORDER BY cc.name_th`,
      values,
    ),
  ]);

  if (status) {
    values.push(status);
    conditions.push(`c.status::text = $${values.length}`);
  }

  if (month) {
    values.push(`${month}-01`);
    conditions.push(
      `c.created_at >= $${values.length}::date
       AND c.created_at < ($${values.length}::date + interval '1 month')`,
    );
  }

  if (categoryId) {
    values.push(categoryId);
    conditions.push(`c.category_id = $${values.length}`);
  }

  // ?mine=true = ดูเฉพาะเรื่องที่ตัวเองถูกมอบหมาย (ใช้ได้ทุก role,
  // แต่เป็นมุมมองหลักของ officer เพราะแก้สถานะได้แค่เรื่องของตัวเอง)
  if (mine) {
    values.push(req.admin.id);
    conditions.push(`c.assigned_staff_user_id = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(
      c.reference_no ILIKE $${values.length}
      OR c.title ILIKE $${values.length}
      OR c.contact_name ILIKE $${values.length}
      OR c.contact_phone ILIKE $${values.length}
    )`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await pool.query(
    `SELECT count(*)::integer AS total FROM complaints c ${where}`,
    values,
  );

  values.push(limit);
  const limitPlaceholder = `$${values.length}`;
  values.push(offset);
  const offsetPlaceholder = `$${values.length}`;

  const result = await pool.query(
    `SELECT
        c.id,
        c.reference_no,
        c.title,
        c.description,
        c.location_text,
        c.latitude,
        c.longitude,
        c.status,
        c.priority,
        c.contact_name,
        c.contact_phone,
        c.contact_email,
        c.line_display_name,
        c.created_at,
        c.updated_at,
        c.due_at,
        c.assigned_staff_user_id,
        c.department_id,
        cc.name_th AS category_name,
        d.name_th AS department_name,
        su.display_name AS assigned_staff_name,
        asp.full_name AS assigned_profile_name,
        asp.position_title AS assigned_profile_position,
        asp.phone AS assigned_profile_phone,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', a.id,
                'originalName', a.original_name,
                'mimeType', a.mime_type,
                 'sizeBytes', a.size_bytes,
                 'width', a.width,
                 'height', a.height,
                 'source', a.attachment_source,
                 'createdAt', a.created_at,
                 'staffNote', a.staff_note,
                 'workPhase', a.work_phase,
                 'staffName', creator.display_name
               )
               ORDER BY a.sort_order, a.created_at
             ),
            '[]'::json
          )
          FROM complaint_attachments a
          LEFT JOIN staff_users creator ON creator.id = a.created_by_staff_user_id
          WHERE a.complaint_id = c.id
        ) AS attachments
       FROM complaints c
       JOIN complaint_categories cc ON cc.id = c.category_id
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN staff_users su ON su.id = c.assigned_staff_user_id
       LEFT JOIN staff_profiles asp ON asp.id = c.assigned_staff_profile_id
       ${where}
      ORDER BY c.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    values,
  );

  const rows = result.rows.map((row) => ({
    ...row,
    canEditStatus:
      isSystemAdminRole(req.admin.role) ||
      isSameDepartmentStaff(req, row.department_id),
  }));

  res.json({
    success: true,
    data: rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0].total,
      totalPages: Math.ceil(countResult.rows[0].total / limit),
    },
    filters: {
      months: monthResult.rows.map((row) => row.value),
      categories: categoryResult.rows,
    },
  });
});

router.get('/complaints/:id', async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) throw new ApiError(400, 'รหัสรายการไม่ถูกต้อง');

  const result = await pool.query(
    `SELECT
        c.*,
        cc.name_th AS category_name,
        d.name_th AS department_name,
        su.display_name AS assigned_staff_name,
        asp.full_name AS assigned_profile_name,
        asp.position_title AS assigned_profile_position,
        asp.phone AS assigned_profile_phone,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', a.id,
                'originalName', a.original_name,
                'mimeType', a.mime_type,
                 'sizeBytes', a.size_bytes,
                 'width', a.width,
                 'height', a.height,
                 'source', a.attachment_source,
                 'createdAt', a.created_at,
                 'staffNote', a.staff_note,
                 'workPhase', a.work_phase,
                 'staffName', creator.display_name
               )
              ORDER BY a.sort_order, a.created_at
            ),
            '[]'::json
          )
          FROM complaint_attachments a
          LEFT JOIN staff_users creator ON creator.id = a.created_by_staff_user_id
          WHERE a.complaint_id = c.id
        ) AS attachments
       FROM complaints c
       JOIN complaint_categories cc ON cc.id = c.category_id
      LEFT JOIN departments d ON d.id = c.department_id
      LEFT JOIN staff_users su ON su.id = c.assigned_staff_user_id
      LEFT JOIN staff_profiles asp ON asp.id = c.assigned_staff_profile_id
      WHERE c.id = $1`,
    [req.params.id],
  );

  if (result.rowCount === 0) throw new ApiError(404, 'ไม่พบรายการ');

  const selectedComplaint = result.rows[0];

  if (
    !canReadAllDepartments(req.admin.role) &&
    selectedComplaint.department_id !== getAdminDepartmentId(req)
  ) {
    throw new ApiError(403, 'ไม่มีสิทธิ์ดูเรื่องร้องเรียนของหน่วยงานอื่น');
  }

  const history = await pool.query(
    `SELECT
        h.old_status,
        h.new_status,
        h.note,
        h.actor_type,
        h.created_at,
        s.display_name AS staff_name
       FROM complaint_status_history h
       LEFT JOIN staff_users s ON s.id = h.actor_staff_user_id
      WHERE h.complaint_id = $1
      ORDER BY h.created_at ASC`,
    [req.params.id],
  );

  const complaint = result.rows[0];
  const canEditStatus =
    isSystemAdminRole(req.admin.role) ||
    isSameDepartmentStaff(req, complaint.department_id);

  res.json({
    success: true,
    data: { ...complaint, canEditStatus, history: history.rows },
  });
});

router.delete('/complaints/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) throw new ApiError(400, 'รหัสเรื่องร้องเรียนไม่ถูกต้อง');
  const parsedBody = z.object({
    reason: z.string().trim().min(4).max(100),
  }).safeParse(req.body);
  if (!parsedBody.success) {
    throw new ApiError(400, 'กรุณาระบุหมายเหตุการลบตั้งแต่ 4 ถึง 100 ตัวอักษร');
  }

  const client = await pool.connect();
  let deletedComplaint;
  let storageKeys = [];

  try {
    await client.query('BEGIN');

    const complaintResult = await client.query(
      `SELECT id, reference_no, title, status
         FROM complaints
        WHERE id = $1
        FOR UPDATE`,
      [parsedId.data],
    );

    if (!complaintResult.rowCount) {
      throw new ApiError(404, 'ไม่พบเรื่องร้องเรียน');
    }

    deletedComplaint = complaintResult.rows[0];
    const attachmentResult = await client.query(
      `SELECT storage_key
         FROM complaint_attachments
        WHERE complaint_id = $1`,
      [parsedId.data],
    );
    storageKeys = attachmentResult.rows.map((row) => row.storage_key);

    await client.query(`DELETE FROM complaint_reviews WHERE complaint_id = $1`, [parsedId.data]);
    await client.query(`DELETE FROM complaint_tasks WHERE complaint_id = $1`, [parsedId.data]);
    await client.query(`DELETE FROM complaint_assignments WHERE complaint_id = $1`, [parsedId.data]);
    await client.query(`DELETE FROM line_notifications WHERE complaint_id = $1`, [parsedId.data]);
    await client.query(`DELETE FROM complaint_attachments WHERE complaint_id = $1`, [parsedId.data]);
    await client.query(`DELETE FROM complaint_status_history WHERE complaint_id = $1`, [parsedId.data]);
    await client.query(`DELETE FROM complaints WHERE id = $1`, [parsedId.data]);

    await writeAudit(
      req,
      'complaint.delete',
      'complaint',
      parsedId.data,
      {
        referenceNo: deletedComplaint.reference_no,
        title: deletedComplaint.title,
        status: deletedComplaint.status,
        deletionReason: parsedBody.data.reason,
        deletedAttachmentCount: storageKeys.length,
      },
      client,
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await cleanupStoredImageKeys(storageKeys);

  res.json({
    success: true,
    message: 'ลบเรื่องร้องเรียนเรียบร้อย',
    data: { referenceNo: deletedComplaint.reference_no },
  });
});

router.post(
  '/complaints/:id/work-attachments',
  uploadStaffWorkImages,
  async (req, res) => {
    const idResult = z.string().uuid().safeParse(req.params.id);
    if (!idResult.success) throw new ApiError(400, 'รหัสรายการไม่ถูกต้อง');

    const parsed = workProgressUpdateSchema.safeParse({
      status: req.body?.status,
      note: req.body?.note,
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        'กรุณาเลือกสถานะกำลังดำเนินการหรือเสร็จสิ้น และตรวจสอบหมายเหตุ',
        parsed.error.flatten(),
      );
    }

    const complaintResult = await pool.query(
      `SELECT id, department_id, status
         FROM complaints
        WHERE id = $1`,
      [req.params.id],
    );
    if (complaintResult.rowCount === 0) throw new ApiError(404, 'ไม่พบรายการ');

    const selectedComplaint = complaintResult.rows[0];
    if (
      !isSystemAdminRole(req.admin.role) &&
      !isSameDepartmentStaff(req, selectedComplaint.department_id)
    ) {
      throw new ApiError(
        403,
        'สามารถแนบรูปได้เฉพาะเรื่องร้องเรียนของหน่วยงานตนเอง',
      );
    }

    const nextStatus = parsed.data.status;
    if (nextStatus !== selectedComplaint.status) {
      const validNextStatuses = allowedTransitions[selectedComplaint.status] || [];
      if (!validNextStatuses.includes(nextStatus)) {
        throw new ApiError(
          409,
          `ไม่สามารถเปลี่ยนสถานะจาก ${selectedComplaint.status} เป็น ${nextStatus} ได้`,
        );
      }
    }

    if (!req.files?.length && nextStatus === selectedComplaint.status && !parsed.data.note) {
      throw new ApiError(400, 'กรุณาแนบรูป ระบุหมายเหตุ หรือเปลี่ยนสถานะก่อนบันทึก');
    }

    let storedImages = [];
    try {
      if (req.files?.length) {
        storedImages = await processAndStoreImages(req.files);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        'อัปโหลดไม่สำเร็จ: เซิร์ฟเวอร์ไม่สามารถประมวลผลหรือบันทึกไฟล์รูปภาพได้ กรุณาลองใหม่',
      );
    }
    const client = await pool.connect();
    let updatedComplaint;
    let previousStatus = selectedComplaint.status;

    try {
      await client.query('BEGIN');
      const currentResult = await client.query(
        `SELECT *
           FROM complaints
          WHERE id = $1
          FOR UPDATE`,
        [req.params.id],
      );
      if (currentResult.rowCount === 0) throw new ApiError(404, 'ไม่พบรายการ');

      const current = currentResult.rows[0];
      previousStatus = current.status;
      if (
        !isSystemAdminRole(req.admin.role) &&
        !isSameDepartmentStaff(req, current.department_id)
      ) {
        throw new ApiError(403, 'สามารถบันทึกได้เฉพาะเรื่องร้องเรียนของหน่วยงานตนเอง');
      }
      if (nextStatus !== current.status) {
        const validNextStatuses = allowedTransitions[current.status] || [];
        if (!validNextStatuses.includes(nextStatus)) {
          throw new ApiError(
            409,
            `ไม่สามารถเปลี่ยนสถานะจาก ${current.status} เป็น ${nextStatus} ได้`,
          );
        }
      }
      const sortResult = await client.query(
        `SELECT COALESCE(max(sort_order), -1)::integer AS last_sort_order
           FROM complaint_attachments
          WHERE complaint_id = $1`,
        [req.params.id],
      );
      const firstSortOrder = sortResult.rows[0].last_sort_order + 1;

      for (let index = 0; index < storedImages.length; index += 1) {
        const image = storedImages[index];
        await client.query(
          `INSERT INTO complaint_attachments (
            complaint_id,
            storage_key,
            original_name,
            mime_type,
            size_bytes,
            width,
            height,
            sha256,
            sort_order,
            attachment_source,
            created_by_staff_user_id,
            staff_note,
            work_phase
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staff',$10,$11,$12)`,
          [
            req.params.id,
            image.storageKey,
            image.originalName,
            image.mimeType,
            image.sizeBytes,
            image.width,
            image.height,
            image.sha256,
            firstSortOrder + index,
            req.admin.id,
            parsed.data.note,
            nextStatus,
          ],
        );
      }

      const updateResult = await client.query(
        `UPDATE complaints
            SET status = $2,
                completed_at = CASE
                  WHEN $2 = 'completed'::complaint_status
                    THEN COALESCE(completed_at, current_timestamp)
                  ELSE completed_at
                END,
                updated_at = current_timestamp
          WHERE id = $1
          RETURNING *`,
        [req.params.id, nextStatus],
      );
      updatedComplaint = updateResult.rows[0];

      await client.query(
        `INSERT INTO complaint_status_history (
          complaint_id,
          old_status,
          new_status,
          note,
          actor_type,
          actor_staff_user_id
        ) VALUES ($1,$2,$3,$4,'staff',$5)`,
        [
          req.params.id,
          current.status,
          updatedComplaint.status,
          parsed.data.note ||
            (updatedComplaint.status === 'completed'
              ? `บันทึกสถานะเสร็จสิ้น${storedImages.length ? ` พร้อมรูป ${storedImages.length} ภาพ` : ''}`
              : `บันทึกสถานะกำลังดำเนินการ${storedImages.length ? ` พร้อมรูป ${storedImages.length} ภาพ` : ''}`),
          req.admin.id,
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      await cleanupStoredImages(storedImages);
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        'อัปโหลดไม่สำเร็จ: ไม่สามารถบันทึกข้อมูลรูปภาพลงระบบได้ กรุณาลองใหม่',
      );
    } finally {
      client.release();
    }

    await writeAudit(
      req,
      'complaint.work_progress.update',
      'complaint',
      req.params.id,
      {
        imageCount: storedImages.length,
        note: parsed.data.note,
        oldStatus: previousStatus,
        newStatus: updatedComplaint.status,
        workPhase: nextStatus,
      },
    );

    const lineNotified = await notifyStatusChanged(
      updatedComplaint,
      parsed.data.note ||
        (updatedComplaint.status === 'completed'
          ? 'เจ้าหน้าที่ดำเนินงานเสร็จสิ้นแล้ว'
          : 'เจ้าหน้าที่เริ่มดำเนินการแล้ว'),
    );

    res.status(201).json({
      success: true,
      message: lineNotified
        ? updatedComplaint.status === 'completed'
          ? 'บันทึกสถานะเสร็จสิ้นและแจ้ง LINE เรียบร้อย'
          : 'บันทึกสถานะกำลังดำเนินการและแจ้ง LINE เรียบร้อย'
        : 'บันทึกสถานะเรียบร้อย แต่แจ้ง LINE ไม่สำเร็จ กรุณาตรวจสอบการตั้งค่า LINE',
      data: {
        imageCount: storedImages.length,
        status: updatedComplaint.status,
        lineNotified,
      },
    });
  },
);

router.patch('/complaints/:id/status', async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) throw new ApiError(400, 'รหัสรายการไม่ถูกต้อง');

  const parsed = statusUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'ข้อมูลสถานะไม่ถูกต้อง', parsed.error.flatten());
  }

  const client = await pool.connect();
  let complaint;

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT * FROM complaints WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );

    if (currentResult.rowCount === 0) {
      throw new ApiError(404, 'ไม่พบรายการ');
    }

    const current = currentResult.rows[0];
    const nextStatus = parsed.data.status;

    if (
      !isSystemAdminRole(req.admin.role) &&
      !isSameDepartmentStaff(req, current.department_id)
    ) {
      throw new ApiError(
        403,
        'Officer และ Supervisor สามารถอัปเดตสถานะได้เฉพาะเรื่องของหน่วยงานตนเอง',
      );
    }

    if (nextStatus !== current.status) {
      const validNextStatuses = allowedTransitions[current.status] || [];
      if (!validNextStatuses.includes(nextStatus)) {
        throw new ApiError(
          409,
          `ไม่สามารถเปลี่ยนสถานะจาก ${current.status} เป็น ${nextStatus} ได้`,
        );
      }
    }

    const updateResult = await client.query(
      `UPDATE complaints
          SET status = $1,
              completed_at = CASE
                WHEN $1 = 'completed'::complaint_status
                  THEN COALESCE(completed_at, current_timestamp)
                ELSE completed_at
              END,
              updated_at = current_timestamp
        WHERE id = $2
        RETURNING *`,
      [nextStatus, req.params.id],
    );
    complaint = updateResult.rows[0];

    await client.query(
      `INSERT INTO complaint_status_history (
          complaint_id,
          old_status,
          new_status,
          note,
          actor_type,
          actor_staff_user_id
       ) VALUES ($1, $2, $3, $4, 'staff', $5)`,
      [
        complaint.id,
        current.status,
        nextStatus,
        parsed.data.note,
        req.admin.id,
      ],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await writeAudit(req, 'complaint.status.update', 'complaint', complaint.id, { status: complaint.status, note: parsed.data.note });

  await notifyStatusChanged(complaint, parsed.data.note);

  res.json({
    success: true,
    message: 'ปรับปรุงสถานะเรียบร้อย',
    data: {
      id: complaint.id,
      referenceNo: complaint.reference_no,
      status: complaint.status,
      updatedAt: complaint.updated_at,
    },
  });
});



router.get('/dashboard', async (req, res) => {
  const globalAccess = canReadAllDepartments(req.admin.role);
  const departmentId = globalAccess
    ? getRequestedDepartmentId(req)
    : getAdminDepartmentId(req);
  const scopeByDepartment = Boolean(departmentId);

  if (!globalAccess && !departmentId) {
    throw new ApiError(403, 'บัญชีนี้ยังไม่ได้กำหนดหน่วยงาน');
  }

  const values = scopeByDepartment ? [departmentId] : [];
  const whereScope = scopeByDepartment ? 'WHERE c.department_id = $1' : '';
  const andScope = scopeByDepartment ? 'AND c.department_id = $1' : '';
  const joinScope = scopeByDepartment ? 'AND c.department_id = $1' : '';

  const [
    summary,
    recent,
    categories,
    departments,
    statusBreakdown,
    monthlyTrend,
    urgentCases,
    mapCases,
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (WHERE c.status IN ('new','received'))::integer AS pending,
        count(*) FILTER (WHERE c.status IN ('assigned','in_progress','waiting_for_info'))::integer AS in_progress,
        count(*) FILTER (WHERE c.status = 'completed')::integer AS completed,
        count(*) FILTER (
          WHERE c.due_at IS NOT NULL
            AND c.due_at < current_timestamp
            AND c.status NOT IN ('completed','rejected','cancelled')
        )::integer AS overdue,
        count(*) FILTER (
          WHERE c.created_at >= date_trunc('month', current_timestamp)
        )::integer AS this_month,
        count(*) FILTER (
          WHERE c.priority IN ('high','urgent')
            AND c.status NOT IN ('completed','rejected','cancelled')
        )::integer AS high_priority,
        COALESCE(
          round(
            avg(
              EXTRACT(
                EPOCH FROM (
                  COALESCE(c.completed_at, current_timestamp) - c.created_at
                )
              ) / 86400
            )::numeric,
            1
          ),
          0
        ) AS avg_days
      FROM complaints c
      ${whereScope}
      `,
      values,
    ),

    pool.query(
      `
      SELECT
        c.id,
        c.reference_no,
        c.title,
        c.status,
        c.priority,
        c.created_at,
        c.due_at,
        cc.name_th AS category_name,
        d.name_th AS department_name
      FROM complaints c
      JOIN complaint_categories cc ON cc.id = c.category_id
      LEFT JOIN departments d ON d.id = c.department_id
      ${whereScope}
      ORDER BY c.created_at DESC
      LIMIT 8
      `,
      values,
    ),

    pool.query(
      `
      SELECT
        cc.name_th AS label,
        count(c.id)::integer AS value
      FROM complaint_categories cc
      LEFT JOIN complaints c
        ON c.category_id = cc.id
        ${joinScope}
      WHERE cc.is_active = true
        ${scopeByDepartment ? 'AND cc.department_id = $1' : ''}
      GROUP BY cc.id, cc.name_th, cc.sort_order
      ORDER BY value DESC, cc.sort_order
      `,
      values,
    ),

    pool.query(
      `
      SELECT
        d.name_th AS label,
        count(c.id)::integer AS value
      FROM departments d
      LEFT JOIN complaints c
        ON c.department_id = d.id
        ${joinScope}
      WHERE d.is_active = true
        ${scopeByDepartment ? 'AND d.id = $1' : ''}
      GROUP BY d.id, d.name_th
      ORDER BY value DESC, d.name_th
      `,
      values,
    ),

    pool.query(
      `
      SELECT
        c.status::text AS label,
        count(*)::integer AS value
      FROM complaints c
      ${whereScope}
      GROUP BY c.status
      ORDER BY value DESC
      `,
      values,
    ),

    pool.query(
      `
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', current_timestamp) - interval '5 months',
          date_trunc('month', current_timestamp),
          interval '1 month'
        ) AS month_start
      )
      SELECT
        to_char(m.month_start, 'YYYY-MM') AS month,
        count(c.id)::integer AS received,
        count(c.id) FILTER (WHERE c.status = 'completed')::integer AS completed
      FROM months m
      LEFT JOIN complaints c
        ON date_trunc('month', c.created_at) = m.month_start
        ${joinScope}
      GROUP BY m.month_start
      ORDER BY m.month_start
      `,
      values,
    ),

    pool.query(
      `
      SELECT
        c.id,
        c.reference_no,
        c.title,
        c.status,
        c.priority,
        c.due_at,
        d.name_th AS department_name
      FROM complaints c
      LEFT JOIN departments d ON d.id = c.department_id
      WHERE c.status NOT IN ('completed','rejected','cancelled')
        ${andScope}
        AND (
          c.priority IN ('high','urgent')
          OR (
            c.due_at IS NOT NULL
            AND c.due_at < current_timestamp + interval '2 days'
          )
        )
      ORDER BY
        CASE c.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          ELSE 3
        END,
        c.due_at NULLS LAST
      LIMIT 6
      `,
      values,
    ),

    pool.query(
      `
      SELECT
        c.id,
        c.reference_no,
        c.title,
        c.status,
        c.latitude,
        c.longitude,
        c.location_text,
        c.created_at,
        cc.name_th AS category_name,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', a.id,
                'originalName', a.original_name
              )
              ORDER BY a.sort_order, a.created_at
            )
            FROM complaint_attachments a
            WHERE a.complaint_id = c.id
              AND a.attachment_source = 'citizen'
          ),
          '[]'::json
        ) AS citizen_attachments
      FROM complaints c
      JOIN complaint_categories cc ON cc.id = c.category_id
      WHERE c.latitude IS NOT NULL
        AND c.longitude IS NOT NULL
        ${andScope}
      ORDER BY c.created_at DESC
      LIMIT 100
      `,
      values,
    ),
  ]);

  let backendUsage = null;
  if (isSystemAdminRole(req.admin.role)) {
    const [userCountResult, departmentLoginResult] = await Promise.all([
      pool.query(`
        SELECT
          count(*)::integer AS total_users,
          count(*) FILTER (WHERE is_active = true)::integer AS active_users,
          count(*) FILTER (WHERE is_active = false)::integer AS inactive_users,
          count(*) FILTER (
            WHERE is_active = true
              AND last_login_at >= current_timestamp - interval '30 days'
          )::integer AS recent_login_users,
          count(*) FILTER (
            WHERE is_active = true
              AND (
                last_login_at IS NULL
                OR last_login_at < current_timestamp - interval '30 days'
              )
          )::integer AS no_recent_login_users
        FROM staff_users
      `),
      pool.query(`
        SELECT
          d.name_th AS label,
          count(su.id) FILTER (
            WHERE su.is_active = true
              AND su.last_login_at >= current_timestamp - interval '30 days'
          )::integer AS value,
          max(su.last_login_at) AS latest_login_at
        FROM departments d
        LEFT JOIN staff_users su ON su.department_id = d.id
        WHERE d.is_active = true
        GROUP BY d.id, d.name_th
        HAVING count(su.id) FILTER (
          WHERE su.is_active = true
            AND su.last_login_at >= current_timestamp - interval '30 days'
        ) > 0
        ORDER BY value DESC, latest_login_at DESC, d.name_th
        LIMIT 8
      `),
    ]);

    const counts = userCountResult.rows[0];
    const topDepartment = departmentLoginResult.rows[0] ?? null;
    backendUsage = {
      ...counts,
      department_name: topDepartment?.label ?? null,
      active_user_count: topDepartment?.value ?? 0,
      period_days: 30,
      user_status_breakdown: [
        { label: 'recent_login', value: counts.recent_login_users },
        { label: 'no_recent_login', value: counts.no_recent_login_users },
        { label: 'inactive', value: counts.inactive_users },
      ],
      department_login_breakdown: departmentLoginResult.rows,
    };
  }

  res.json({
    success: true,
    data: {
      summary: summary.rows[0],
      recent: recent.rows,
      categoryBreakdown: categories.rows,
      departmentBreakdown: departments.rows,
      statusBreakdown: statusBreakdown.rows,
      monthlyTrend: monthlyTrend.rows,
      urgentCases: urgentCases.rows,
      mapCases: mapCases.rows,
      ...(backendUsage ? { backendUsage } : {}),
    },
  });
});

router.get('/departments', async (req, res) => {
  const result = await pool.query(
    `SELECT id, code, name_th FROM departments WHERE is_active = true ORDER BY name_th`,
  );
  res.json({ success: true, data: result.rows });
});

router.get('/staff', requireRoles('admin', 'dev', 'supervisor', 'executive', 'exclusive'), async (req, res) => {
  const values = [];
  let where = `WHERE su.is_active = true`;

  if (req.admin.role === 'supervisor') {
    values.push(req.admin.departmentId ?? null);
    where += ` AND su.department_id = $1`;
  }

  const result = await pool.query(
    `SELECT
        su.id,
        su.username,
        su.display_name,
        su.role,
        su.department_id,
        d.name_th AS department_name
       FROM staff_users su
       LEFT JOIN departments d ON d.id = su.department_id
       ${where}
      ORDER BY su.display_name`,
    values,
  );

  res.json({ success: true, data: result.rows });
});

router.get(
  '/assignment-staff',
  requireRoles('admin', 'dev', 'supervisor', 'officer'),
  async (req, res) => {
    const parsed = z.object({ departmentId: z.string().uuid() }).safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, 'กรุณาเลือกหน่วยงานก่อนเลือกเจ้าหน้าที่');

    if (
      !isSystemAdminRole(req.admin.role) &&
      parsed.data.departmentId !== getAdminDepartmentId(req)
    ) {
      throw new ApiError(403, 'ไม่มีสิทธิ์ดูข้อมูลเจ้าหน้าที่ของหน่วยงานอื่น');
    }

    const result = await pool.query(
      `SELECT id, full_name, position_title, phone, department_id
         FROM staff_profiles
        WHERE department_id = $1
        ORDER BY full_name`,
      [parsed.data.departmentId],
    );
    res.json({ success: true, data: result.rows });
  },
);

router.patch(
  '/complaints/:id/assignment',
  requireRoles('admin', 'dev', 'supervisor', 'officer'),
  async (req, res) => {
    const idResult = z.string().uuid().safeParse(req.params.id);
    if (!idResult.success) {
      throw new ApiError(400, 'รหัสรายการไม่ถูกต้อง');
    }

    const schema = z.object({
      departmentId: z.string().uuid().nullable().optional(),
      staffProfileId: z.string().uuid().nullable().optional(),
      priority: z.enum(['low','normal','high','urgent']).default('normal'),
      dueAt: z.string().datetime().nullable().optional(),
      note: z.string().trim().max(2000).nullable().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(
        400,
        'ข้อมูลการมอบหมายไม่ถูกต้อง',
        parsed.error.flatten(),
      );
    }

    const currentResult = await pool.query(
      `SELECT id, department_id, assigned_staff_profile_id, status
         FROM complaints
        WHERE id = $1`,
      [req.params.id],
    );

    if (currentResult.rowCount === 0) {
      throw new ApiError(404, 'ไม่พบรายการ');
    }

    const current = currentResult.rows[0];
    let departmentId = current.department_id;

    if (isSystemAdminRole(req.admin.role)) {
      if (Object.hasOwn(parsed.data, 'departmentId')) {
        departmentId = parsed.data.departmentId;
      }
    } else if (req.admin.role === 'supervisor') {
      if (!isSameDepartmentStaff(req, current.department_id)) {
        throw new ApiError(
          403,
          'Supervisor สามารถแก้ไขได้เฉพาะเรื่องของหน่วยงานตนเอง',
        );
      }

      if (Object.hasOwn(parsed.data, 'departmentId')) {
        if (!parsed.data.departmentId) {
          throw new ApiError(400, 'Supervisor ต้องเลือกหน่วยงานปลายทาง');
        }

        const targetDepartment = await pool.query(
          `SELECT id
             FROM departments
            WHERE id = $1
              AND is_active = true`,
          [parsed.data.departmentId],
        );

        if (targetDepartment.rowCount === 0) {
          throw new ApiError(400, 'ไม่พบหน่วยงานปลายทางหรือหน่วยงานถูกปิดใช้งาน');
        }

        departmentId = parsed.data.departmentId;
      }
    } else {
      if (!isSameDepartmentStaff(req, current.department_id)) {
        throw new ApiError(
          403,
          'Officer สามารถแก้ไขได้เฉพาะเรื่องของหน่วยงานตนเอง',
        );
      }

      if (
        Object.hasOwn(parsed.data, 'departmentId') &&
        parsed.data.departmentId !== current.department_id
      ) {
        throw new ApiError(
          403,
          'Officer ไม่สามารถเปลี่ยนหน่วยงานของเรื่องร้องเรียนได้',
        );
      }
    }

    let assignedStaffProfileId = Object.hasOwn(parsed.data, 'staffProfileId')
      ? parsed.data.staffProfileId
      : current.assigned_staff_profile_id;
    if (departmentId !== current.department_id && !Object.hasOwn(parsed.data, 'staffProfileId')) {
      assignedStaffProfileId = null;
    }

    let assignedStaffProfile = null;
    if (assignedStaffProfileId) {
      if (!departmentId) throw new ApiError(400, 'กรุณาเลือกหน่วยงานก่อนเลือกเจ้าหน้าที่');
      const profileResult = await pool.query(
        `SELECT id, full_name, position_title, phone, line_id, department_id
           FROM staff_profiles
          WHERE id = $1
            AND department_id = $2`,
        [assignedStaffProfileId, departmentId],
      );
      if (!profileResult.rowCount) {
        throw new ApiError(400, 'ไม่พบเจ้าหน้าที่ในหน่วยงานที่เลือก');
      }
      assignedStaffProfile = profileResult.rows[0];
    }

    const result = await pool.query(
      `UPDATE complaints
          SET department_id = $1,
              assigned_staff_profile_id = $2,
              assigned_staff_user_id = NULL,
              priority = $3,
              due_at = $4,
              status = CASE
                WHEN $1::uuid IS NOT NULL AND status IN ('new', 'received')
                  THEN 'assigned'::complaint_status
                WHEN $1::uuid IS NULL AND status = 'assigned'
                  THEN 'received'::complaint_status
                ELSE status
              END,
              updated_at = current_timestamp
        WHERE id = $5
        RETURNING *`,
      [
        departmentId,
        assignedStaffProfileId,
        parsed.data.priority,
        parsed.data.dueAt ?? null,
        req.params.id,
      ],
    );

    await pool.query(
      `INSERT INTO complaint_status_history (
        complaint_id,
        old_status,
        new_status,
        note,
        actor_type,
        actor_staff_user_id
      ) VALUES ($1, $2, $3, $4, 'staff', $5)`,
      [
        req.params.id,
        current.status,
        result.rows[0].status,
        parsed.data.note || (assignedStaffProfile
          ? `มอบหมายเจ้าหน้าที่ ${assignedStaffProfile.full_name}`
          : departmentId
            ? 'มอบหมายหน่วยงานแล้ว'
            : 'บันทึกข้อมูลโดยยังไม่มอบหมายหน่วยงาน'),
        req.admin.id,
      ],
    );

    await writeAudit(
      req,
      'complaint.assignment.update',
      'complaint',
      req.params.id,
      {
        departmentId,
        staffProfileId: assignedStaffProfileId,
        staffName: assignedStaffProfile?.full_name ?? null,
        staffPhone: assignedStaffProfile?.phone ?? null,
        priority: parsed.data.priority,
        dueAt: parsed.data.dueAt ?? null,
        note: parsed.data.note ?? null,
        status: result.rows[0].status,
      },
    );

    const statusChanged = current.status !== result.rows[0].status;
    const assignmentChanged = Boolean(departmentId) && (
      current.department_id !== departmentId ||
      current.assigned_staff_profile_id !== assignedStaffProfileId ||
      (current.status !== 'assigned' && result.rows[0].status === 'assigned')
    );
    const lineNotified = assignmentChanged
      ? await notifyAssignmentChanged(
          {
            ...result.rows[0],
            assigned_staff_name: assignedStaffProfile?.full_name ?? null,
            assigned_staff_position: assignedStaffProfile?.position_title ?? null,
            assigned_staff_phone: assignedStaffProfile?.phone ?? null,
            assigned_staff_line_id: assignedStaffProfile?.line_id ?? null,
          },
          parsed.data.note,
        )
      : null;

    const message = assignmentChanged
      ? lineNotified
        ? 'บันทึกการมอบหมายและแจ้งประชาชนผ่าน LINE เรียบร้อย'
        : 'บันทึกการมอบหมายเรียบร้อย แต่แจ้งประชาชนผ่าน LINE ไม่สำเร็จ'
      : departmentId
        ? 'บันทึกการมอบหมายเรียบร้อย โดยข้อมูลการมอบหมายไม่เปลี่ยนจึงไม่ส่ง LINE ซ้ำ'
        : 'บันทึกข้อมูลเรียบร้อย โดยยังไม่มีการมอบหมายจึงไม่ส่ง LINE';

    res.json({
      success: true,
      message,
      data: {
        ...result.rows[0],
        assignedStaffName: assignedStaffProfile?.full_name ?? null,
        assignedStaffPhone: assignedStaffProfile?.phone ?? null,
        statusChanged,
        assignmentChanged,
        lineNotified,
      },
    });
  },
);


router.get('/governance/categories', requireRoles('admin','dev','supervisor','executive','exclusive'), async (req, res) => {
  const result = await pool.query(`
    SELECT
      cc.id,
      cc.code,
      cc.name_th,
      cc.department_id,
      d.name_th AS department_name,
      cc.sla_hours,
      cc.is_active,
      count(c.id)::integer AS complaint_count,
      cc.created_at,
      cc.updated_at
    FROM complaint_categories cc
    LEFT JOIN departments d ON d.id = cc.department_id
    LEFT JOIN complaints c ON c.category_id = cc.id
    GROUP BY cc.id, d.name_th
    ORDER BY cc.sort_order, cc.name_th
  `);
  res.json({ success: true, data: result.rows });
});

router.post('/governance/categories', requireRoles('admin', 'dev'), async (req, res) => {
  const schema = z.object({ code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/), nameTh: z.string().trim().min(2).max(200), departmentId: z.string().uuid(), slaHours: z.coerce.number().int().min(1).max(8760).default(72) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'ข้อมูลหมวดหมู่ไม่ถูกต้อง', parsed.error.flatten());
  const department = await pool.query(`SELECT id FROM departments WHERE id=$1 AND is_active=true`, [parsed.data.departmentId]);
  if (!department.rowCount) throw new ApiError(400, 'ไม่พบหน่วยงานที่เลือกหรือหน่วยงานถูกปิดใช้งาน');
  const result = await pool.query(`INSERT INTO complaint_categories (code,name_th,department_id,sla_hours) VALUES ($1,$2,$3,$4) RETURNING *`, [parsed.data.code, parsed.data.nameTh, parsed.data.departmentId, parsed.data.slaHours]);
  await writeAudit(req, 'category.create', 'complaint_category', result.rows[0].id, parsed.data);
  res.status(201).json({ success:true, data:result.rows[0] });
});

router.patch('/governance/categories/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const schema = z.object({ code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/), nameTh: z.string().trim().min(2).max(200), departmentId: z.string().uuid(), slaHours: z.coerce.number().int().min(1).max(8760), isActive: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'ข้อมูลหมวดหมู่ไม่ถูกต้อง', parsed.error.flatten());
  const department = await pool.query(`SELECT id FROM departments WHERE id=$1 AND is_active=true`, [parsed.data.departmentId]);
  if (!department.rowCount) throw new ApiError(400, 'ไม่พบหน่วยงานที่เลือกหรือหน่วยงานถูกปิดใช้งาน');
  const duplicate = await pool.query(`SELECT id FROM complaint_categories WHERE code=$1 AND id<>$2`, [parsed.data.code, req.params.id]);
  if (duplicate.rowCount) throw new ApiError(409, 'รหัสหมวดหมู่นี้ถูกใช้งานแล้ว');
  const result = await pool.query(`UPDATE complaint_categories SET code=$1,name_th=$2,department_id=$3,sla_hours=$4,is_active=$5,updated_at=current_timestamp WHERE id=$6 RETURNING *`, [parsed.data.code,parsed.data.nameTh,parsed.data.departmentId,parsed.data.slaHours,parsed.data.isActive,req.params.id]);
  if (!result.rowCount) throw new ApiError(404,'ไม่พบหมวดหมู่');
  await writeAudit(req, 'category.update', 'complaint_category', req.params.id, parsed.data);
  res.json({ success:true, data:result.rows[0] });
});

router.delete('/governance/categories/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) throw new ApiError(400, 'รหัสหมวดหมู่ไม่ถูกต้อง');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryResult = await client.query(
      `SELECT id, code, name_th
         FROM complaint_categories
        WHERE id = $1
        FOR UPDATE`,
      [idResult.data],
    );

    if (!categoryResult.rowCount) throw new ApiError(404, 'ไม่พบหมวดหมู่');
    const category = categoryResult.rows[0];
    const usageResult = await client.query(
      `SELECT count(*)::integer AS complaint_count
         FROM complaints
        WHERE category_id = $1`,
      [idResult.data],
    );
    const complaintCount = usageResult.rows[0].complaint_count;
    if (complaintCount > 0) {
      throw new ApiError(
        409,
        `ไม่สามารถลบหมวดหมู่นี้ได้ เนื่องจากมีเรื่องร้องเรียนใช้งานอยู่ ${complaintCount} เรื่อง กรุณาปิดใช้งานแทน`,
      );
    }

    await client.query(`DELETE FROM complaint_categories WHERE id = $1`, [idResult.data]);
    await writeAudit(
      req,
      'category.delete',
      'complaint_category',
      idResult.data,
      { code: category.code, nameTh: category.name_th },
      client,
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'ลบหมวดหมู่เรียบร้อย' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.get('/governance/departments', requireRoles('admin','dev','supervisor','executive','exclusive'), async (req, res) => {
  const result = await pool.query(`SELECT id, code, name_th, is_active, created_at, updated_at FROM departments ORDER BY name_th`);
  res.json({ success:true, data:result.rows });
});

router.post('/governance/departments', requireRoles('admin', 'dev'), async (req, res) => {
  const schema=z.object({code:z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/),nameTh:z.string().trim().min(2).max(200)});
  const parsed=schema.safeParse(req.body); if(!parsed.success) throw new ApiError(400,'ข้อมูลหน่วยงานไม่ถูกต้อง',parsed.error.flatten());
  const result=await pool.query(`INSERT INTO departments (code,name_th) VALUES ($1,$2) RETURNING *`,[parsed.data.code,parsed.data.nameTh]);
  await writeAudit(req,'department.create','department',result.rows[0].id,parsed.data);
  res.status(201).json({success:true,data:result.rows[0]});
});

router.patch('/governance/departments/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const schema=z.object({code:z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/),nameTh:z.string().trim().min(2).max(200),isActive:z.boolean()});
  const parsed=schema.safeParse(req.body); if(!parsed.success) throw new ApiError(400,'ข้อมูลหน่วยงานไม่ถูกต้อง',parsed.error.flatten());
  const duplicate=await pool.query(`SELECT id FROM departments WHERE code=$1 AND id<>$2`,[parsed.data.code,req.params.id]);
  if(duplicate.rowCount) throw new ApiError(409,'รหัสหน่วยงานนี้ถูกใช้งานแล้ว');
  const result=await pool.query(`UPDATE departments SET code=$1,name_th=$2,is_active=$3,updated_at=current_timestamp WHERE id=$4 RETURNING *`,[parsed.data.code,parsed.data.nameTh,parsed.data.isActive,req.params.id]);
  if(!result.rowCount) throw new ApiError(404,'ไม่พบหน่วยงาน');
  await writeAudit(req,'department.update','department',req.params.id,parsed.data);
  res.json({success:true,data:result.rows[0]});
});

const staffProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  positionTitle: z.string().trim().min(2).max(200),
  departmentId: z.string().uuid(),
  lineId: z.preprocess(
    (value) => (value == null ? '' : value),
    z.string().trim().max(100).transform((value) => value || null),
  ),
  phone: z.preprocess(
    (value) => (value == null ? '' : value),
    z.string()
    .trim()
    .max(30)
    .refine(
      (value) => value === '' || /^[0-9+()\-\s]+$/.test(value),
      'เบอร์โทรศัพท์ไม่ถูกต้อง',
    )
    .refine(
      (value) => value === '' || value.replace(/\D/g, '').length >= 9,
      'เบอร์โทรศัพท์ไม่ถูกต้อง',
    )
    .transform((value) => value || null),
  ),
});

router.get('/governance/staff-profiles', requireRoles('admin', 'dev'), async (req, res) => {
  const parsed = z.object({ departmentId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'หน่วยงานที่ใช้กรองไม่ถูกต้อง');
  const values = parsed.data.departmentId ? [parsed.data.departmentId] : [];
  const where = parsed.data.departmentId ? 'WHERE sp.department_id = $1' : '';
  const result = await pool.query(
    `SELECT
        sp.id,
        sp.full_name,
        sp.position_title,
        sp.department_id,
        sp.line_id,
        sp.phone,
        sp.created_at,
        sp.updated_at,
        d.name_th AS department_name
       FROM staff_profiles sp
       LEFT JOIN departments d ON d.id = sp.department_id
       ${where}
       ORDER BY sp.full_name`,
    values,
  );
  res.json({ success: true, data: result.rows });
});

router.post('/governance/staff-profiles', requireRoles('admin', 'dev'), async (req, res) => {
  const parsed = staffProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'ข้อมูลเจ้าหน้าที่ไม่ถูกต้อง', parsed.error.flatten());
  }

  const departmentResult = await pool.query(
    `SELECT id FROM departments WHERE id = $1 AND is_active = true`,
    [parsed.data.departmentId],
  );
  if (!departmentResult.rowCount) {
    throw new ApiError(400, 'ไม่พบหน่วยงาน หรือหน่วยงานถูกปิดใช้งาน');
  }

  let result;
  try {
    result = await pool.query(
      `INSERT INTO staff_profiles (full_name, position_title, department_id, line_id, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, position_title, department_id, line_id, phone, created_at, updated_at`,
      [
        parsed.data.fullName,
        parsed.data.positionTitle,
        parsed.data.departmentId,
        parsed.data.lineId,
        parsed.data.phone,
      ],
    );
  } catch (error) {
    if (error?.code === '23505') {
      throw new ApiError(409, 'LINE ID นี้มีอยู่ในข้อมูลเจ้าหน้าที่แล้ว');
    }
    throw error;
  }

  await writeAudit(req, 'staff_profile.create', 'staff_profile', result.rows[0].id, {
    fullName: parsed.data.fullName,
    departmentId: parsed.data.departmentId,
  });
  res.status(201).json({ success: true, data: result.rows[0] });
});

router.patch('/governance/staff-profiles/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) throw new ApiError(400, 'รหัสข้อมูลเจ้าหน้าที่ไม่ถูกต้อง');

  const parsed = staffProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'ข้อมูลเจ้าหน้าที่ไม่ถูกต้อง', parsed.error.flatten());
  }

  const departmentResult = await pool.query(
    `SELECT id FROM departments WHERE id = $1 AND is_active = true`,
    [parsed.data.departmentId],
  );
  if (!departmentResult.rowCount) {
    throw new ApiError(400, 'ไม่พบหน่วยงาน หรือหน่วยงานถูกปิดใช้งาน');
  }

  let result;
  try {
    result = await pool.query(
      `UPDATE staff_profiles
          SET full_name = $1,
              position_title = $2,
              department_id = $3,
              line_id = $4,
              phone = $5,
              updated_at = current_timestamp
        WHERE id = $6
        RETURNING id, full_name, position_title, department_id, line_id, phone, created_at, updated_at`,
      [
        parsed.data.fullName,
        parsed.data.positionTitle,
        parsed.data.departmentId,
        parsed.data.lineId,
        parsed.data.phone,
        idResult.data,
      ],
    );
  } catch (error) {
    if (error?.code === '23505') {
      throw new ApiError(409, 'LINE ID นี้มีอยู่ในข้อมูลเจ้าหน้าที่แล้ว');
    }
    throw error;
  }

  if (!result.rowCount) throw new ApiError(404, 'ไม่พบข้อมูลเจ้าหน้าที่');
  await writeAudit(req, 'staff_profile.update', 'staff_profile', idResult.data, {
    fullName: parsed.data.fullName,
    departmentId: parsed.data.departmentId,
  });
  res.json({ success: true, data: result.rows[0] });
});

router.delete('/governance/staff-profiles/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) throw new ApiError(400, 'รหัสข้อมูลเจ้าหน้าที่ไม่ถูกต้อง');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const profileResult = await client.query(
      `SELECT id, full_name, position_title, department_id, line_id, phone
         FROM staff_profiles
        WHERE id = $1
        FOR UPDATE`,
      [idResult.data],
    );
    if (!profileResult.rowCount) throw new ApiError(404, 'ไม่พบข้อมูลเจ้าหน้าที่');

    const profile = profileResult.rows[0];
    await client.query(`DELETE FROM staff_profiles WHERE id = $1`, [idResult.data]);
    await writeAudit(
      req,
      'staff_profile.delete',
      'staff_profile',
      idResult.data,
      {
        fullName: profile.full_name,
        positionTitle: profile.position_title,
        departmentId: profile.department_id,
        lineId: profile.line_id,
        phone: profile.phone,
      },
      client,
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'ลบข้อมูลเจ้าหน้าที่เรียบร้อย' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.get('/governance/users', requireRoles('admin', 'dev'), async (req, res) => {
  const result = await pool.query(
    `SELECT
        su.id,
        su.username,
        su.display_name,
        su.role,
        su.department_id,
        su.is_active,
        su.last_login_at,
        su.created_at,
        d.code AS department_code,
        d.name_th AS department_name
       FROM staff_users su
       LEFT JOIN departments d ON d.id = su.department_id
      ORDER BY su.display_name`,
  );

  res.json({ success: true, data: result.rows });
});

router.post('/governance/users', requireRoles('admin', 'dev'), async (req, res) => {
  const schema = z.object({
    username: z.string().trim().min(3).max(100),
    password: z.string().min(12).max(200),
    displayName: z.string().trim().min(2).max(200),
    role: z.enum(['officer', 'supervisor', 'executive', 'admin', 'dev']),
    departmentId: z.string().uuid().nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'ข้อมูลผู้ใช้งานไม่ถูกต้อง',
      parsed.error.flatten(),
    );
  }

  if (parsed.data.role === 'dev') {
    throw new ApiError(
      403,
      'ไม่สามารถเพิ่มบัญชี DEV จากหน้าจัดการผู้ใช้งานได้ ต้องสร้างผ่านคำสั่ง admin:create บนเครื่องเซิร์ฟเวอร์เท่านั้น',
    );
  }

  const departmentId =
    ['admin', 'dev', 'executive'].includes(parsed.data.role)
      ? null
      : parsed.data.departmentId ?? null;

  if (['officer', 'supervisor'].includes(parsed.data.role) && !departmentId) {
    throw new ApiError(
      400,
      'Officer และ Supervisor ต้องกำหนดหน่วยงาน',
    );
  }

  if (departmentId) {
    const departmentResult = await pool.query(
      `SELECT id
         FROM departments
        WHERE id = $1
          AND is_active = true`,
      [departmentId],
    );

    if (departmentResult.rowCount === 0) {
      throw new ApiError(
        400,
        'ไม่พบหน่วยงาน หรือหน่วยงานถูกปิดใช้งาน',
      );
    }

    // หนึ่งหน่วยงานมี Officer และ Supervisor ได้มากกว่าหนึ่งคน
    // (ข้อจำกัดเดิมถูกยกเลิกใน migration 028)
  }

  const hash = await bcrypt.hash(parsed.data.password, 12);

  let result;
  try {
    result = await pool.query(
      `INSERT INTO staff_users (
          username,
          password_hash,
          display_name,
          role,
          department_id
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING
          id,
          username,
          display_name,
          role,
          department_id,
          is_active,
          created_at`,
      [
        parsed.data.username,
        hash,
        parsed.data.displayName,
        parsed.data.role,
        departmentId,
      ],
    );
  } catch (error) {
    if (error?.code === '23505') {
      throw new ApiError(
        409,
        'ชื่อผู้ใช้นี้มีอยู่แล้ว',
      );
    }
    throw error;
  }

  await writeAudit(
    req,
    'staff.create',
    'staff_user',
    result.rows[0].id,
    {
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      departmentId,
    },
  );

  res.status(201).json({ success: true, data: result.rows[0] });
});

router.patch('/governance/users/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) {
    throw new ApiError(400, 'รหัสผู้ใช้งานไม่ถูกต้อง');
  }

  const schema = z.object({
    displayName: z.string().trim().min(2).max(200),
    role: z.enum(['officer', 'supervisor', 'executive', 'admin', 'dev']),
    departmentId: z.string().uuid().nullable().optional(),
    isActive: z.boolean(),
    password: z.string().min(12).max(200).nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'ข้อมูลผู้ใช้งานไม่ถูกต้อง',
      parsed.error.flatten(),
    );
  }

  const existingUserResult = await pool.query(
    `SELECT id, role
       FROM staff_users
      WHERE id = $1`,
    [idResult.data],
  );
  if (!existingUserResult.rowCount) {
    throw new ApiError(404, 'ไม่พบผู้ใช้งาน');
  }

  const existingUser = existingUserResult.rows[0];
  if (existingUser.role === 'dev' && req.admin.role !== 'dev') {
    throw new ApiError(403, 'Admin ไม่สามารถแก้ไขบัญชี DEV ได้');
  }
  if (parsed.data.role === 'dev' && existingUser.role !== 'dev') {
    throw new ApiError(
      403,
      'ไม่สามารถแต่งตั้งผู้ใช้งานเป็น DEV จากหน้าจัดการผู้ใช้งานได้',
    );
  }
  if (existingUser.role === 'dev' && parsed.data.role !== 'dev') {
    throw new ApiError(409, 'ไม่สามารถเปลี่ยนสิทธิ์ของบัญชี DEV ได้');
  }

  const departmentId =
    ['admin', 'dev', 'executive'].includes(parsed.data.role)
      ? null
      : parsed.data.departmentId ?? null;

  if (
    parsed.data.isActive &&
    ['officer', 'supervisor'].includes(parsed.data.role) &&
    !departmentId
  ) {
    throw new ApiError(
      400,
      'Officer และ Supervisor ที่เปิดใช้งานต้องกำหนดหน่วยงาน',
    );
  }

  if (departmentId) {
    const departmentResult = await pool.query(
      `SELECT id
         FROM departments
        WHERE id = $1
          AND is_active = true`,
      [departmentId],
    );

    if (departmentResult.rowCount === 0) {
      throw new ApiError(
        400,
        'ไม่พบหน่วยงาน หรือหน่วยงานถูกปิดใช้งาน',
      );
    }

    // หนึ่งหน่วยงานมี Officer และ Supervisor ได้มากกว่าหนึ่งคน
    // (ข้อจำกัดเดิมถูกยกเลิกใน migration 028)
  }

  const values = [
    parsed.data.displayName,
    parsed.data.role,
    departmentId,
    parsed.data.isActive,
  ];

  let passwordSql = '';
  if (parsed.data.password) {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    values.push(hash);
    passwordSql = `, password_hash = $${values.length}`;
  }

  values.push(req.params.id);

  let result;
  try {
    result = await pool.query(
      `UPDATE staff_users
          SET display_name = $1,
              role = $2,
              department_id = $3,
              is_active = $4
              ${passwordSql},
              updated_at = current_timestamp
        WHERE id = $${values.length}
        RETURNING
          id,
          username,
          display_name,
          role,
          department_id,
          is_active`,
      values,
    );
  } catch (error) {
    if (error?.code === '23505') {
      throw new ApiError(
        409,
        'ข้อมูลซ้ำกับผู้ใช้งานที่มีอยู่แล้ว',
      );
    }
    throw error;
  }

  if (!result.rowCount) {
    throw new ApiError(404, 'ไม่พบผู้ใช้งาน');
  }

  await writeAudit(
    req,
    'staff.update',
    'staff_user',
    req.params.id,
    {
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      departmentId,
      isActive: parsed.data.isActive,
      passwordChanged: Boolean(parsed.data.password),
    },
  );

  res.json({ success: true, data: result.rows[0] });
});

router.delete('/governance/users/:id', requireRoles('admin', 'dev'), async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) throw new ApiError(400, 'รหัสผู้ใช้งานไม่ถูกต้อง');
  if (idResult.data === req.admin.id) {
    throw new ApiError(409, 'ไม่สามารถลบบัญชีที่กำลังเข้าสู่ระบบอยู่ได้');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `SELECT id, username, display_name, role
         FROM staff_users
        WHERE id = $1
        FOR UPDATE`,
      [idResult.data],
    );
    if (!userResult.rowCount) throw new ApiError(404, 'ไม่พบผู้ใช้งาน');

    const selectedUser = userResult.rows[0];
    if (selectedUser.role === 'dev') {
      throw new ApiError(409, 'ไม่สามารถลบบัญชี DEV ได้');
    }
    if (isSystemAdminRole(selectedUser.role)) {
      const adminCountResult = await client.query(
        `SELECT count(*)::integer AS admin_count
           FROM staff_users
          WHERE role IN ('admin', 'dev')
            AND is_active = true
            AND id <> $1`,
        [idResult.data],
      );
      if (adminCountResult.rows[0].admin_count === 0) {
        throw new ApiError(409, 'ไม่สามารถลบ Admin คนสุดท้ายของระบบได้');
      }
    }

    try {
      await client.query(`DELETE FROM staff_users WHERE id = $1`, [idResult.data]);
    } catch (error) {
      if (error?.code === '23503') {
        throw new ApiError(
          409,
          'ไม่สามารถลบผู้ใช้งานนี้ได้ เนื่องจากมีประวัติการดำเนินงานหรือข้อมูลอ้างอิง กรุณาระงับบัญชีแทน',
        );
      }
      throw error;
    }

    await writeAudit(
      req,
      'staff.delete',
      'staff_user',
      idResult.data,
      {
        username: selectedUser.username,
        displayName: selectedUser.display_name,
        role: selectedUser.role,
      },
      client,
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'ลบผู้ใช้งานเรียบร้อย' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.get('/governance/audit-logs', requireRoles('admin','dev','supervisor','executive','exclusive'), async (req, res) => {
  if (canReadAllDepartments(req.admin.role)) {
    const result = await pool.query(
      `SELECT
          a.id,
          a.action,
          a.entity_type,
          a.entity_id,
          a.detail,
          a.ip_address,
          a.created_at,
          s.display_name AS actor_name
       FROM audit_logs a
       LEFT JOIN staff_users s ON s.id = a.actor_staff_user_id
       ORDER BY a.created_at DESC
       LIMIT 200`,
    );

    return res.json({ success: true, data: result.rows });
  }

  const departmentId = getAdminDepartmentId(req);
  if (!departmentId) {
    throw new ApiError(403, 'บัญชีนี้ยังไม่ได้กำหนดหน่วยงาน');
  }

  const result = await pool.query(
    `SELECT
        a.id,
        a.action,
        a.entity_type,
        a.entity_id,
        a.detail,
        a.ip_address,
        a.created_at,
        s.display_name AS actor_name
     FROM audit_logs a
     JOIN complaints c
       ON a.entity_type = 'complaint'
      AND a.entity_id = c.id::text
     LEFT JOIN staff_users s ON s.id = a.actor_staff_user_id
     WHERE c.department_id = $1
     ORDER BY a.created_at DESC
     LIMIT 200`,
    [departmentId],
  );

  res.json({ success: true, data: result.rows });
});

//Export complaints report as CSV

router.get('/reports/export.csv', requireRoles('admin', 'dev', 'supervisor', 'executive', 'exclusive'), async (req, res) => {
  const globalAccess = canReadAllDepartments(req.admin.role);
  const departmentId = globalAccess
    ? getRequestedDepartmentId(req)
    : getAdminDepartmentId(req);

  if (!globalAccess && !departmentId) {
    throw new ApiError(403, 'บัญชีนี้ยังไม่ได้กำหนดหน่วยงาน');
  }

  const values = departmentId ? [departmentId] : [];
  const where = departmentId ? 'WHERE c.department_id = $1' : '';

  const result=await pool.query(`SELECT c.reference_no,c.title,cc.name_th AS category,c.status,c.priority,c.contact_name,c.contact_phone,c.location_text,d.name_th AS department,COALESCE(asp.full_name, su.display_name) AS assigned_staff,c.created_at,c.due_at,c.completed_at FROM complaints c JOIN complaint_categories cc ON cc.id=c.category_id LEFT JOIN departments d ON d.id=c.department_id LEFT JOIN staff_users su ON su.id=c.assigned_staff_user_id LEFT JOIN staff_profiles asp ON asp.id=c.assigned_staff_profile_id ${where} ORDER BY c.created_at DESC`, values);
  const headers=['reference_no','title','category','status','priority','contact_name','contact_phone','location_text','department','assigned_staff','created_at','due_at','completed_at'];
  const csv='\ufeff'+[headers.join(','),...result.rows.map(r=>headers.map(h=>escapeCsvField(h==='contact_phone'?toExcelText(r[h]):r[h])).join(','))].join('\n');
  await writeAudit(req,'report.export.csv','report',null,{rows:result.rowCount});
  res.setHeader('content-type','text/csv; charset=utf-8'); res.setHeader('content-disposition','attachment; filename="complaints-report.csv"'); res.send(csv);
});

// ===========================================================================
// นำเข้า / ส่งออกข้อมูลหลังบ้านเป็นไฟล์ CSV
//
// ครอบคลุม 3 ชุดข้อมูล: หน่วยงาน, หมวดหมู่และ SLA, ข้อมูลเจ้าหน้าที่
// ไม่ครอบบัญชีผู้ใช้งาน (staff_users) เพราะมีรหัสผ่านที่ต้องไม่หลุดออกจากฐานข้อมูล
//
// การนำเข้าแบ่งเป็นสองขั้น: ตรวจสอบไฟล์ (preview) แล้วจึงยืนยัน (commit)
// ทั้งสองขั้นใช้ตรรกะวิเคราะห์ชุดเดียวกัน และไม่เก็บสถานะไว้ที่เซิร์ฟเวอร์ระหว่างขั้น
// หน้าเว็บจึงส่งเนื้อไฟล์มาทั้งสองรอบ ทำให้ไม่มีปัญหาไฟล์ค้างหรือเซสชันหมดอายุ
// ===========================================================================

const TRANSFER_DATASETS = {
  departments: {
    label: 'หน่วยงาน',
    headers: ['code', 'name_th', 'is_active'],
    // คอลัมน์ที่ห่อด้วย ="..." ตอนส่งออก เพื่อกัน Excel ตัดเลขศูนย์นำหน้า
    excelTextColumns: [],
    selectSql: `SELECT code, name_th, is_active FROM departments ORDER BY code`,
  },
  categories: {
    label: 'หมวดหมู่และ SLA',
    headers: ['code', 'name_th', 'department_code', 'sla_hours', 'is_active', 'sort_order'],
    excelTextColumns: [],
    selectSql: `SELECT c.code,
                       c.name_th,
                       d.code AS department_code,
                       c.sla_hours,
                       c.is_active,
                       c.sort_order
                  FROM complaint_categories c
                  LEFT JOIN departments d ON d.id = c.department_id
                 ORDER BY c.sort_order, c.code`,
  },
  staffProfiles: {
    label: 'ข้อมูลเจ้าหน้าที่',
    headers: ['full_name', 'position_title', 'department_code', 'line_id', 'phone'],
    excelTextColumns: ['line_id', 'phone'],
    selectSql: `SELECT sp.full_name,
                       sp.position_title,
                       d.code AS department_code,
                       sp.line_id,
                       sp.phone
                  FROM staff_profiles sp
                  LEFT JOIN departments d ON d.id = sp.department_id
                 ORDER BY d.code NULLS LAST, sp.full_name`,
  },
  // บัญชีผู้ใช้งาน ส่งออกได้โดยไม่มีรหัสผ่านเด็ดขาด
  // คอลัมน์ password ในไฟล์ที่ส่งออกจะว่างเสมอ มีไว้ให้กรอกตอนเพิ่มคนใหม่เท่านั้น
  users: {
    label: 'บัญชีผู้ใช้งาน',
    importable: true,
    headers: [
      'username',
      'display_name',
      'role',
      'department_code',
      'is_active',
      'password',
      'last_login_at',
    ],
    excelTextColumns: [],
    selectSql: `SELECT su.username,
                       su.display_name,
                       su.role,
                       d.code AS department_code,
                       su.is_active,
                       '' AS password,
                       su.last_login_at
                  FROM staff_users su
                  LEFT JOIN departments d ON d.id = su.department_id
                 WHERE su.role <> 'dev'
                 ORDER BY su.role, su.username`,
  },
};

const IMPORTABLE_USER_ROLES = ['officer', 'supervisor', 'executive', 'admin'];

// ตรวจจับว่าไฟล์ที่อัปโหลดมาเป็นข้อมูลชุดใด จากชื่อคอลัมน์ในแถวหัวตาราง
// เรียงจากชุดที่มีลักษณะเฉพาะชัดเจนที่สุดไปหาน้อยที่สุด ชุดแรกที่เข้าเงื่อนไขคือคำตอบ
// หน่วยงานกับหมวดหมู่ใช้คอลัมน์ code และ name_th เหมือนกัน จึงแยกด้วย sla_hours
// หรือ sort_order ซึ่งมีเฉพาะในหมวดหมู่ และบังคับว่าชุดหน่วยงานต้องไม่มีคอลัมน์เหล่านั้น
const DATASET_SIGNATURES = [
  { dataset: 'users', required: ['username', 'display_name', 'role'] },
  { dataset: 'staffProfiles', required: ['full_name', 'position_title'] },
  {
    dataset: 'categories',
    required: ['code', 'name_th'],
    anyOf: ['sla_hours', 'sort_order'],
  },
  {
    dataset: 'departments',
    required: ['code', 'name_th'],
    forbidden: ['sla_hours', 'sort_order', 'department_code'],
  },
];

function detectDataset(headerRow) {
  const headers = new Set(headerRow);

  for (const signature of DATASET_SIGNATURES) {
    if (!signature.required.every((name) => headers.has(name))) continue;
    if (signature.anyOf && !signature.anyOf.some((name) => headers.has(name))) continue;
    if (signature.forbidden?.some((name) => headers.has(name))) continue;
    return signature.dataset;
  }

  throw new ApiError(
    400,
    'ไม่สามารถระบุได้ว่าไฟล์นี้เป็นข้อมูลชุดใด กรุณากดส่งออกไฟล์ตัวอย่างของชุดที่ต้องการก่อน แล้วแก้ไขในไฟล์นั้น เพื่อให้หัวตารางตรงกับที่ระบบรู้จัก',
  );
}

// สร้างรหัสผ่านชั่วคราวให้บัญชีใหม่ที่ไม่ได้ระบุรหัสผ่านมาในไฟล์
// ใช้ตัวอักษรที่อ่านแล้วไม่สับสน ตัด O 0 I l 1 ออก เพราะต้องอ่านให้เจ้าหน้าที่ฟัง
function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  let password = '';
  for (const byte of bytes) password += alphabet[byte % alphabet.length];
  return password;
}

function getDataset(name) {
  const dataset = TRANSFER_DATASETS[name];
  if (!dataset) {
    throw new ApiError(400, 'ไม่รู้จักชุดข้อมูลที่ระบุ');
  }
  return dataset;
}

function normalizeText(value) {
  const text = unwrapExcelText(value);
  return text === '' ? null : text;
}

// รับได้ทั้ง true/false, 1/0, ใช่/ไม่, เปิด/ปิด เพราะไฟล์อาจถูกแก้ใน Excel
function parseBoolean(value, fallback = true) {
  const text = String(unwrapExcelText(value)).trim().toLowerCase();
  if (text === '') return fallback;
  if (['true', '1', 'yes', 'y', 'ใช่', 'เปิด', 'เปิดใช้งาน'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'ไม่', 'ไม่ใช่', 'ปิด', 'ปิดใช้งาน'].includes(text)) return false;
  return null;
}

function parseInteger(value, fallback) {
  const text = String(unwrapExcelText(value)).trim();
  if (text === '') return fallback;
  if (!/^-?\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

// ---------------------------------------------------------------------------
// วิเคราะห์ไฟล์ที่อัปโหลด เทียบกับข้อมูลที่มีอยู่ แล้วบอกว่าแต่ละแถวจะเกิดอะไรขึ้น
// ไม่แตะฐานข้อมูล ใช้ได้ทั้งตอนดูตัวอย่างและตอนยืนยัน
// ---------------------------------------------------------------------------
async function analyzeImport(csvText, currentUsername = null) {
  const table = parseCsv(csvText);

  if (!table.length) {
    throw new ApiError(400, 'ไฟล์ว่างเปล่า ไม่พบข้อมูลที่จะนำเข้า');
  }

  const headerRow = table[0].map((cell) => unwrapExcelText(cell).trim().toLowerCase());

  // ผู้ใช้ไม่ต้องเลือกชุดข้อมูลเอง ระบบดูจากหัวตารางว่าไฟล์นี้เป็นข้อมูลชุดใด
  // จึงไม่มีทางเลือกชุดผิดแล้วนำเข้าลงตารางที่ไม่ได้ตั้งใจอีกต่อไป
  const datasetName = detectDataset(headerRow);
  const dataset = getDataset(datasetName);

  if (!dataset.importable) {
    throw new ApiError(400, `${dataset.label} ส่งออกได้อย่างเดียว นำกลับเข้ามาไม่ได้`);
  }

  const columnIndex = Object.fromEntries(
    dataset.headers.map((name) => [name, headerRow.indexOf(name)]),
  );
  const cell = (row, name) => {
    const index = columnIndex[name];
    return index >= 0 ? row[index] : '';
  };

  // ข้อมูลปัจจุบันในฐานข้อมูล ใช้ตัดสินว่าแถวนี้จะเพิ่มใหม่หรืออัปเดต
  const departmentRows = await pool.query(`SELECT id, code FROM departments`);
  const departmentIdByCode = new Map(departmentRows.rows.map((r) => [r.code, r.id]));

  const plan = [];
  let inserts = 0;
  let updates = 0;
  let errors = 0;

  const seenKeys = new Set();

  let existingByKey = new Map();
  let lineIdOwner = new Map();

  if (datasetName === 'departments') {
    const rows = await pool.query(`SELECT code FROM departments`);
    existingByKey = new Map(rows.rows.map((r) => [r.code, r]));
  } else if (datasetName === 'categories') {
    const rows = await pool.query(`SELECT code FROM complaint_categories`);
    existingByKey = new Map(rows.rows.map((r) => [r.code, r]));
  } else if (datasetName === 'users') {
    const rows = await pool.query(
      `SELECT lower(username) AS key, username, role FROM staff_users`,
    );
    existingByKey = new Map(rows.rows.map((r) => [r.key, r]));
  } else {
    const rows = await pool.query(
      `SELECT sp.full_name, sp.line_id, d.code AS department_code
         FROM staff_profiles sp
         LEFT JOIN departments d ON d.id = sp.department_id`,
    );
    for (const r of rows.rows) {
      const key = `${r.department_code ?? ''}|${String(r.full_name).trim()}`;
      existingByKey.set(key, r);
      if (r.line_id) lineIdOwner.set(String(r.line_id).toLowerCase(), key);
    }
  }

  for (let index = 1; index < table.length; index += 1) {
    const row = table[index];
    const lineNumber = index + 1;
    const problems = [];
    // notes คือสิ่งที่ควรรู้ไว้แต่ไม่ได้ขัดขวางการนำเข้า ต่างจาก problems ที่ทำให้ทั้งไฟล์ถูกปฏิเสธ
    const notes = [];
    let key = null;
    let values = {};

    if (datasetName === 'departments') {
      const code = normalizeText(cell(row, 'code'));
      const nameTh = normalizeText(cell(row, 'name_th'));
      const isActive = parseBoolean(cell(row, 'is_active'));

      if (!code) problems.push('ไม่ได้ระบุรหัสหน่วยงาน (code)');
      if (!nameTh) problems.push('ไม่ได้ระบุชื่อหน่วยงาน (name_th)');
      if (isActive === null) problems.push('ค่าสถานะ (is_active) ไม่ถูกต้อง ใช้ได้เฉพาะ true หรือ false');

      key = code;
      values = { code, name_th: nameTh, is_active: isActive };
    } else if (datasetName === 'categories') {
      const code = normalizeText(cell(row, 'code'));
      const nameTh = normalizeText(cell(row, 'name_th'));
      const departmentCode = normalizeText(cell(row, 'department_code'));
      const slaHours = parseInteger(cell(row, 'sla_hours'), 72);
      const isActive = parseBoolean(cell(row, 'is_active'));
      const sortOrder = parseInteger(cell(row, 'sort_order'), 100);

      if (!code) problems.push('ไม่ได้ระบุรหัสหมวดหมู่ (code)');
      if (!nameTh) problems.push('ไม่ได้ระบุชื่อหมวดหมู่ (name_th)');
      if (slaHours === null || slaHours <= 0) problems.push('ค่า SLA (sla_hours) ต้องเป็นจำนวนเต็มบวก');
      if (sortOrder === null) problems.push('ค่าลำดับ (sort_order) ต้องเป็นจำนวนเต็ม');
      if (isActive === null) problems.push('ค่าสถานะ (is_active) ไม่ถูกต้อง ใช้ได้เฉพาะ true หรือ false');
      if (departmentCode && !departmentIdByCode.has(departmentCode)) {
        problems.push(`ไม่พบหน่วยงานรหัส ${departmentCode} ในระบบ`);
      }

      key = code;
      values = {
        code,
        name_th: nameTh,
        department_code: departmentCode,
        sla_hours: slaHours,
        is_active: isActive,
        sort_order: sortOrder,
      };
    } else if (datasetName === 'users') {
      const username = normalizeText(cell(row, 'username'));
      const displayName = normalizeText(cell(row, 'display_name'));
      const role = (normalizeText(cell(row, 'role')) || '').toLowerCase() || null;
      const departmentCode = normalizeText(cell(row, 'department_code'));
      const isActive = parseBoolean(cell(row, 'is_active'));
      const password = normalizeText(cell(row, 'password'));

      key = username ? username.toLowerCase() : null;
      const existing = key ? existingByKey.get(key) : null;

      if (!username) problems.push('ไม่ได้ระบุชื่อผู้ใช้ (username)');
      else if (username.length < 3) problems.push('ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร');
      if (!displayName) problems.push('ไม่ได้ระบุชื่อที่แสดง (display_name)');
      if (isActive === null) problems.push('ค่าสถานะ (is_active) ไม่ถูกต้อง ใช้ได้เฉพาะ true หรือ false');

      if (!role) {
        problems.push('ไม่ได้ระบุสิทธิ์ (role)');
      } else if (role === 'dev') {
        // เหตุผลเดียวกับหน้าจัดการผู้ใช้งาน การนำเข้าไฟล์ต้องไม่กลายเป็น
        // ช่องทางอ้อมให้ตั้งบัญชีสิทธิ์สูงสุดโดยข้ามการตรวจสอบ
        problems.push('ไม่สามารถสร้างหรือแก้บัญชีสิทธิ์ DEV ผ่านการนำเข้าไฟล์ได้');
      } else if (!IMPORTABLE_USER_ROLES.includes(role)) {
        problems.push(`สิทธิ์ ${role} ไม่ถูกต้อง ใช้ได้เฉพาะ ${IMPORTABLE_USER_ROLES.join(' / ')}`);
      }

      if (existing?.role === 'dev') {
        problems.push('บัญชีนี้มีสิทธิ์ DEV อยู่แล้ว จึงแก้ไขผ่านการนำเข้าไฟล์ไม่ได้');
      }

      // Officer และ Supervisor ต้องสังกัดหน่วยงาน ส่วนสิทธิ์ระดับบริหารดูได้ทุกหน่วยงาน
      const needsDepartment = ['officer', 'supervisor'].includes(role);
      if (departmentCode && !departmentIdByCode.has(departmentCode)) {
        problems.push(`ไม่พบหน่วยงานรหัส ${departmentCode} ในระบบ`);
      }
      if (needsDepartment && !departmentCode) {
        problems.push('สิทธิ์ Officer และ Supervisor ต้องระบุหน่วยงาน (department_code)');
      }

      if (password && (password.length < 12 || password.length > 200)) {
        problems.push('รหัสผ่านต้องยาว 12 ถึง 200 ตัวอักษร');
      }
      if (!existing && !password) {
        // ไม่ปฏิเสธ แต่บอกให้รู้ว่าระบบจะตั้งรหัสผ่านชั่วคราวให้และแสดงครั้งเดียว
        notes.push('ไม่ได้ระบุรหัสผ่าน ระบบจะสร้างรหัสผ่านชั่วคราวให้และแสดงหลังนำเข้าสำเร็จ');
      }

      // กันไม่ให้ผู้นำเข้าปิดบัญชีตัวเองหรือลดสิทธิ์ตัวเองจนเข้าระบบไม่ได้อีก
      if (existing && currentUsername && key === currentUsername.toLowerCase()) {
        if (isActive === false) problems.push('ไม่สามารถปิดใช้งานบัญชีที่กำลังใช้อยู่ได้');
        if (role && role !== existing.role) problems.push('ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีที่กำลังใช้อยู่ได้');
      }

      values = {
        username,
        display_name: displayName,
        role,
        department_code: needsDepartment ? departmentCode : null,
        is_active: isActive,
        password,
      };
    } else {
      const fullName = normalizeText(cell(row, 'full_name'));
      const positionTitle = normalizeText(cell(row, 'position_title'));
      const departmentCode = normalizeText(cell(row, 'department_code'));
      const lineId = normalizeText(cell(row, 'line_id'));
      const phone = normalizeText(cell(row, 'phone'));

      if (!fullName) problems.push('ไม่ได้ระบุชื่อ-สกุล (full_name)');
      if (!positionTitle) problems.push('ไม่ได้ระบุตำแหน่ง (position_title)');
      if (departmentCode && !departmentIdByCode.has(departmentCode)) {
        problems.push(`ไม่พบหน่วยงานรหัส ${departmentCode} ในระบบ`);
      }

      key = fullName ? `${departmentCode ?? ''}|${fullName}` : null;

      // ไฟล์ 022 มี unique index บน LOWER(line_id) ทั้งตาราง
      // ถ้าไอดีไลน์นี้เป็นของคนอื่นอยู่แล้ว การนำเข้าจะล้มด้วยรหัส 23505
      // จับตั้งแต่ตอนตรวจไฟล์จะอธิบายให้ผู้ใช้เข้าใจได้ดีกว่าปล่อยให้ฐานข้อมูลปฏิเสธ
      if (lineId) {
        const owner = lineIdOwner.get(lineId.toLowerCase());
        if (owner && owner !== key) {
          problems.push(`ไอดีไลน์ ${lineId} ถูกใช้โดยเจ้าหน้าที่คนอื่นอยู่แล้ว`);
        }
      }

      values = {
        full_name: fullName,
        position_title: positionTitle,
        department_code: departmentCode,
        line_id: lineId,
        phone,
      };
    }

    if (key && seenKeys.has(key)) {
      problems.push('รายการนี้ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน');
    }
    if (key) seenKeys.add(key);

    let action;
    if (problems.length) {
      action = 'error';
      errors += 1;
    } else if (existingByKey.has(key)) {
      action = 'update';
      updates += 1;
    } else {
      action = 'insert';
      inserts += 1;
    }

    plan.push({ line: lineNumber, action, values, problems, notes });
  }

  return {
    dataset: datasetName,
    label: dataset.label,
    total: plan.length,
    summary: { insert: inserts, update: updates, error: errors },
    rows: plan,
  };
}

// ---------------------------------------------------------------------------
// ส่งออกเป็นไฟล์ CSV
// ---------------------------------------------------------------------------
router.get('/governance/export.csv', requireRoles('admin', 'dev'), async (req, res) => {
  const datasetName = String(req.query.dataset ?? '');
  const dataset = getDataset(datasetName);

  const result = await pool.query(dataset.selectSql);
  const body = result.rows.map((row) =>
    dataset.headers
      .map((name) =>
        dataset.excelTextColumns.includes(name)
          ? escapeCsvField(toExcelText(row[name]))
          : escapeCsvField(row[name]),
      )
      .join(','),
  );
  // BOM ข้างหน้าเพื่อให้ Excel อ่านภาษาไทยได้ถูกต้อง
  const csv = '﻿' + [dataset.headers.join(','), ...body].join('\n');

  await writeAudit(req, 'governance.export.csv', 'governance', null, {
    dataset: datasetName,
    rows: result.rowCount,
  });

  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${datasetName}.csv"`);
  res.send(csv);
});

// ---------------------------------------------------------------------------
// ขั้นที่ 1 ตรวจไฟล์แล้วบอกว่าจะเกิดอะไรขึ้น ยังไม่แตะฐานข้อมูล
// ---------------------------------------------------------------------------
router.post('/governance/import/preview', requireRoles('admin', 'dev'), async (req, res) => {
  const parsed = z
    .object({ csv: z.string().min(1).max(400_000) })
    .safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง', parsed.error.flatten());
  }

  const plan = await analyzeImport(parsed.data.csv, req.admin.username);

  // ไม่ส่งรหัสผ่านที่ผู้ใช้กรอกมากลับไปแสดงบนหน้าจอ แสดงเป็นสถานะแทน
  if (plan.dataset === 'users') {
    plan.rows = plan.rows.map((row) => ({
      ...row,
      values: {
        ...row.values,
        password: row.values.password ? 'ตั้งรหัสผ่านใหม่' : '',
      },
    }));
  }

  res.json({ data: plan });
});

// ---------------------------------------------------------------------------
// ขั้นที่ 2 ยืนยันแล้วเขียนลงฐานข้อมูลจริง
// วิเคราะห์ไฟล์ใหม่อีกรอบ ไม่เชื่อผลที่หน้าเว็บส่งมา เผื่อข้อมูลเปลี่ยนระหว่างสองขั้น
// ---------------------------------------------------------------------------
router.post('/governance/import/commit', requireRoles('admin', 'dev'), async (req, res) => {
  const parsed = z
    .object({
      csv: z.string().min(1).max(400_000),
      // ชุดข้อมูลที่หน้าเว็บเห็นตอนกดตรวจสอบ ใช้เทียบเท่านั้น ไม่ได้ใช้ตัดสิน
      expectedDataset: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง', parsed.error.flatten());
  }

  const plan = await analyzeImport(parsed.data.csv, req.admin.username);
  const datasetName = plan.dataset;

  // กันกรณีไฟล์ถูกสลับระหว่างขั้นตรวจสอบกับขั้นยืนยัน จนกลายเป็นข้อมูลคนละชุด
  if (parsed.data.expectedDataset && parsed.data.expectedDataset !== datasetName) {
    throw new ApiError(
      409,
      `ไฟล์ที่ยืนยันเป็นข้อมูลชุด "${plan.label}" ซึ่งไม่ตรงกับที่แสดงตอนตรวจสอบ กรุณาตรวจสอบไฟล์ใหม่อีกครั้ง`,
    );
  }

  // ถ้ามีแถวผิดพลาดจะไม่นำเข้าเลยแม้แต่แถวเดียว
  // เพื่อไม่ให้ได้ข้อมูลเข้าไปครึ่งๆ กลางๆ แล้วตามแก้ยาก
  if (plan.summary.error > 0) {
    throw new ApiError(
      400,
      `ไฟล์มีข้อผิดพลาด ${plan.summary.error} แถว จึงยังไม่นำเข้าข้อมูลใดเลย กรุณาแก้ไฟล์แล้วลองใหม่`,
    );
  }

  // รหัสผ่านที่ระบบสร้างให้บัญชีใหม่ ส่งกลับให้ผู้ดูแลครั้งเดียวเท่านั้น
  // ไม่ได้บันทึกไว้ที่ใด และไม่ได้เขียนลง audit log
  const generatedPasswords = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of plan.rows) {
      const v = row.values;

      if (datasetName === 'departments') {
        await client.query(
          `INSERT INTO departments (code, name_th, is_active)
           VALUES ($1, $2, $3)
           ON CONFLICT (code) DO UPDATE SET
             name_th = EXCLUDED.name_th,
             is_active = EXCLUDED.is_active,
             updated_at = current_timestamp`,
          [v.code, v.name_th, v.is_active],
        );
      } else if (datasetName === 'categories') {
        await client.query(
          `INSERT INTO complaint_categories (code, name_th, sla_hours, is_active, sort_order, department_id)
           SELECT $1, $2, $3, $4, $5, d.id
             FROM (SELECT 1) AS anchor
             LEFT JOIN departments d ON d.code = $6
           ON CONFLICT (code) DO UPDATE SET
             name_th = EXCLUDED.name_th,
             sla_hours = EXCLUDED.sla_hours,
             is_active = EXCLUDED.is_active,
             sort_order = EXCLUDED.sort_order,
             department_id = EXCLUDED.department_id,
             updated_at = current_timestamp`,
          [v.code, v.name_th, v.sla_hours, v.is_active, v.sort_order, v.department_code],
        );
      } else if (datasetName === 'users') {
        const isNew = row.action === 'insert';
        // บัญชีใหม่ที่ไม่ได้ระบุรหัสผ่านมา ระบบตั้งให้ชั่วคราวแล้วแสดงครั้งเดียว
        const plainPassword = v.password || (isNew ? generateTemporaryPassword() : null);
        const passwordHash = plainPassword ? await bcrypt.hash(plainPassword, 12) : null;

        if (isNew) {
          await client.query(
            `INSERT INTO staff_users (username, password_hash, display_name, role, department_id, is_active)
             SELECT $1, $2, $3, $4, d.id, $6
               FROM (SELECT 1) AS anchor
               LEFT JOIN departments d ON d.code = $5`,
            [v.username, passwordHash, v.display_name, v.role, v.department_code, v.is_active],
          );
        } else {
          await client.query(
            `UPDATE staff_users AS su
                SET display_name = $2,
                    role = $3,
                    department_id = target.department_id,
                    is_active = $5,
                    password_hash = COALESCE($6, su.password_hash),
                    updated_at = current_timestamp
               FROM (SELECT d.id AS department_id FROM (SELECT 1) AS anchor
                      LEFT JOIN departments d ON d.code = $4) AS target
              WHERE lower(su.username) = lower($1)`,
            [v.username, v.display_name, v.role, v.department_code, v.is_active, passwordHash],
          );
        }

        // เปลี่ยนรหัสผ่านหรือปิดบัญชีแล้วต้องเตะเซสชันเดิมออกทันที
        // ไม่เช่นนั้น token ที่ออกไปก่อนหน้าจะยังใช้งานได้จนกว่าจะหมดอายุ
        if (!isNew && (passwordHash || v.is_active === false)) {
          await client.query(
            `UPDATE staff_sessions s
                SET revoked_at = current_timestamp,
                    revoked_reason = $2
               FROM staff_users u
              WHERE u.id = s.staff_user_id
                AND lower(u.username) = lower($1)
                AND s.revoked_at IS NULL`,
            [v.username, v.is_active === false ? 'account_disabled' : 'manual'],
          );
        }

        if (isNew && !v.password) {
          generatedPasswords.push({ username: v.username, password: plainPassword });
        }
      } else {
        // ตัวระบุตัวตนคือ ชื่อ-สกุล + หน่วยงาน เพราะตารางนี้ไม่มีรหัสประจำตัว
        const updated = await client.query(
          `UPDATE staff_profiles AS sp
              SET position_title = $2,
                  line_id        = $3,
                  phone          = $4
             FROM (SELECT d.id AS department_id FROM (SELECT 1) AS anchor
                    LEFT JOIN departments d ON d.code = $5) AS target
            WHERE sp.department_id IS NOT DISTINCT FROM target.department_id
              AND BTRIM(sp.full_name) = BTRIM($1)
          RETURNING sp.id`,
          [v.full_name, v.position_title, v.line_id, v.phone, v.department_code],
        );

        if (!updated.rowCount) {
          await client.query(
            `INSERT INTO staff_profiles (full_name, position_title, line_id, phone, department_id)
             SELECT $1, $2, $3, $4, d.id
               FROM (SELECT 1) AS anchor
               LEFT JOIN departments d ON d.code = $5`,
            [v.full_name, v.position_title, v.line_id, v.phone, v.department_code],
          );
        }
      }
    }

    await writeAudit(
      req,
      'governance.import.csv',
      'governance',
      null,
      {
        dataset: datasetName,
        inserted: plan.summary.insert,
        updated: plan.summary.update,
      },
      client,
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') {
      throw new ApiError(409, 'ข้อมูลซ้ำกับที่มีอยู่ในระบบ จึงยกเลิกการนำเข้าทั้งหมด');
    }
    throw error;
  } finally {
    client.release();
  }

  res.json({
    data: {
      dataset: datasetName,
      label: plan.label,
      inserted: plan.summary.insert,
      updated: plan.summary.update,
      ...(generatedPasswords.length ? { generatedPasswords } : {}),
    },
  });
});


export default router;
