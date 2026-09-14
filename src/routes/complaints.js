import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireLineUser } from '../middleware/line-auth.js';
import { ApiError } from '../errors.js';
import { complaintCreateSchema } from '../validators.js';
import { createReferenceNumber } from '../utils/reference.js';
import { notifyComplaintCreated } from '../services/notifications.js';
import {
  cleanupStoredImages,
  processAndStoreImages,
  sendStoredImage,
  uploadComplaintImages,
} from '../services/uploads.js';

const router = Router();
router.use(requireLineUser);

function multipartPayload(body) {
  const latitude =
    body.latitude === undefined || body.latitude === ''
      ? null
      : Number(body.latitude);
  const longitude =
    body.longitude === undefined || body.longitude === ''
      ? null
      : Number(body.longitude);

  return {
    categoryId: body.categoryId,
    title: body.title,
    description: body.description,
    locationText: body.locationText,
    latitude,
    longitude,
    contactName: body.contactName,
    contactPhone: body.contactPhone,
    contactEmail: body.contactEmail,
    privacyConsent: body.privacyConsent === 'true',
  };
}

router.post('/', uploadComplaintImages, async (req, res) => {
  const parsed = complaintCreateSchema.safeParse(multipartPayload(req.body));
  if (!parsed.success) {
    throw new ApiError(400, 'ข้อมูลไม่ถูกต้อง', parsed.error.flatten());
  }

  if (!req.files?.length) {
    throw new ApiError(400, 'กรุณาแนบรูปภาพประกอบอย่างน้อย 1 ภาพ');
  }

  const input = parsed.data;
  const storedImages = await processAndStoreImages(req.files);
  let client;
  let complaint;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const categoryResult = await client.query(
      `SELECT
          cc.id,
          cc.department_id,
          cc.sla_hours
         FROM complaint_categories cc
         INNER JOIN departments d
           ON d.id = cc.department_id
          AND d.is_active = true
        WHERE cc.id = $1
          AND cc.is_active = true`,
      [input.categoryId],
    );

    if (categoryResult.rowCount === 0) {
      throw new ApiError(
        400,
        'ไม่พบหมวดหมู่ หรือหมวดหมู่นี้ยังไม่ได้กำหนดหน่วยงานรับผิดชอบ',
      );
    }

    const category = categoryResult.rows[0];

    const sequenceResult = await client.query(
      `SELECT nextval('complaint_reference_seq') AS sequence_value`,
    );
    const referenceNo = createReferenceNumber(
      sequenceResult.rows[0].sequence_value,
    );

    let lineUserRecordId = null;
    if (req.lineUser.userId) {
      const lineUserResult = await client.query(
        `INSERT INTO line_users (
            line_user_id,
            display_name,
            picture_url,
            updated_at
         ) VALUES ($1, $2, $3, current_timestamp)
         ON CONFLICT (line_user_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, line_users.display_name),
             picture_url = COALESCE(EXCLUDED.picture_url, line_users.picture_url),
             updated_at = current_timestamp
         RETURNING id`,
        [
          req.lineUser.userId,
          req.lineUser.displayName,
          req.lineUser.pictureUrl,
        ],
      );
      lineUserRecordId = lineUserResult.rows[0].id;
    }

    const result = await client.query(
      `INSERT INTO complaints (
          reference_no,
          line_user_id,
          line_display_name,
          line_user_record_id,
          category_id,
          department_id,
          title,
          description,
          location_text,
          latitude,
          longitude,
          contact_name,
          contact_phone,
          contact_email,
          due_at,
          privacy_consent_at,
          privacy_consent_version,
          status
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          current_timestamp + make_interval(hours => $15::integer),
          current_timestamp, '1.1',
          'received'::complaint_status
       )
       RETURNING *`,
      [
        referenceNo,
        req.lineUser.userId,
        req.lineUser.displayName,
        lineUserRecordId,
        category.id,
        category.department_id,
        input.title,
        input.description,
        input.locationText,
        input.latitude,
        input.longitude,
        req.lineUser.displayName || input.contactName,
        input.contactPhone,
        input.contactEmail,
        category.sla_hours,
      ],
    );

    complaint = result.rows[0];

    for (const image of storedImages) {
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
          sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          complaint.id,
          image.storageKey,
          image.originalName,
          image.mimeType,
          image.sizeBytes,
          image.width,
          image.height,
          image.sha256,
          image.sortOrder,
        ],
      );
    }

    await client.query(
      `INSERT INTO complaint_status_history (
          complaint_id, old_status, new_status, note, actor_type, actor_line_user_id
       ) VALUES ($1, NULL, $2, $3, 'citizen', $4)`,
      [
        complaint.id,
        complaint.status,
        req.lineUser.isDevBypass
          ? `สร้างเรื่องร้องเรียนผ่านโหมดทดสอบ Local พร้อมรูปภาพ ${storedImages.length} ภาพ`
          : `สร้างเรื่องร้องเรียนผ่าน LINE OA พร้อมรูปภาพ ${storedImages.length} ภาพ`,
        req.lineUser.userId,
      ],
    );

    await client.query('COMMIT');
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Complaint transaction rollback failed:', rollbackError);
      }
    }
    await cleanupStoredImages(storedImages);
    throw error;
  } finally {
    client?.release();
  }

  if (complaint.line_user_id) {
    await notifyComplaintCreated(complaint);
  }

  res.status(201).json({
    success: true,
    message: 'บันทึกเรื่องร้องเรียนเรียบร้อย',
    data: {
      id: complaint.id,
      referenceNo: complaint.reference_no,
      status: complaint.status,
      createdAt: complaint.created_at,
      imageCount: storedImages.length,
    },
  });
});

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT
        c.id,
        c.reference_no,
        c.title,
        COALESCE(NULLIF(BTRIM(c.description), ''), '-') AS description,
        c.status,
        c.location_text,
        c.latitude,
        c.longitude,
        c.created_at,
        c.updated_at,
        c.due_at,
        cc.name_th AS category_name,
        d.name_th AS department_name,
        asp.full_name AS assigned_staff_name,
        asp.position_title AS assigned_staff_position,
        asp.phone AS assigned_staff_phone,
        asp.line_id AS assigned_staff_line_id,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'old_status', h.old_status,
                'new_status', h.new_status,
                'note', h.note,
                'created_at', h.created_at
              )
              ORDER BY h.created_at
            ),
            '[]'::json
          )
          FROM complaint_status_history h
          WHERE h.complaint_id = c.id
        ) AS history,
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
       LEFT JOIN staff_profiles asp ON asp.id = c.assigned_staff_profile_id
      WHERE (($1::varchar IS NULL AND c.line_user_id IS NULL) OR c.line_user_id = $1)
      ORDER BY c.created_at DESC
      LIMIT 100`,
    [req.lineUser.userId],
  );

  res.json({ success: true, data: result.rows });
});

router.get('/:referenceNo/attachments/:attachmentId', async (req, res) => {
  const attachmentId = z.string().uuid().safeParse(req.params.attachmentId);
  if (!attachmentId.success) {
    throw new ApiError(400, 'รหัสรูปภาพไม่ถูกต้อง');
  }

  const result = await pool.query(
    `SELECT a.id, a.storage_key, a.mime_type
       FROM complaint_attachments a
       JOIN complaints c ON c.id = a.complaint_id
      WHERE a.id = $1
        AND c.reference_no = $2
        AND (($3::varchar IS NULL AND c.line_user_id IS NULL) OR c.line_user_id = $3)`,
    [
      req.params.attachmentId,
      req.params.referenceNo,
      req.lineUser.userId,
    ],
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, 'ไม่พบรูปภาพ หรือท่านไม่มีสิทธิ์ดูรูปนี้');
  }

  return sendStoredImage(res, result.rows[0]);
});

router.get('/:referenceNo', async (req, res) => {
  const result = await pool.query(
    `SELECT
        c.id,
        c.reference_no,
        c.title,
        COALESCE(NULLIF(BTRIM(c.description), ''), '-') AS description,
        c.location_text,
        c.latitude,
        c.longitude,
        c.status,
        c.created_at,
        c.updated_at,
        c.due_at,
        cc.name_th AS category_name,
        d.name_th AS department_name,
        asp.full_name AS assigned_staff_name,
        asp.position_title AS assigned_staff_position,
        asp.phone AS assigned_staff_phone,
        asp.line_id AS assigned_staff_line_id,
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
       LEFT JOIN staff_profiles asp ON asp.id = c.assigned_staff_profile_id
      WHERE c.reference_no = $1
        AND (($2::varchar IS NULL AND c.line_user_id IS NULL) OR c.line_user_id = $2)`,
    [req.params.referenceNo, req.lineUser.userId],
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, 'ไม่พบเรื่องร้องเรียน หรือท่านไม่มีสิทธิ์ดูรายการนี้');
  }

  const history = await pool.query(
    `SELECT old_status, new_status, note, created_at
       FROM complaint_status_history
      WHERE complaint_id = $1
      ORDER BY created_at ASC`,
    [result.rows[0].id],
  );

  res.json({
    success: true,
    data: {
      ...result.rows[0],
      history: history.rows,
    },
  });
});

export default router;
