import { Router } from 'express';
import { pool } from '../db.js';
import {
  verifyWebhookSignature,
  replyTextMessage,
} from '../services/line.js';
import { getStatusLabel } from '../services/notifications.js';
import { logger } from '../logger.js';

const router = Router();

async function processEvent(event) {
  const userId = event.source?.userId;

  if (event.type === 'follow' && event.replyToken) {
    await replyTextMessage(
      event.replyToken,
      [
        'ยินดีต้อนรับสู่ระบบรับเรื่องร้องเรียน',
        'กรุณากดเมนู “แจ้งเรื่อง” เพื่อกรอกข้อมูล',
        'หรือพิมพ์ “สถานะ” เพื่อตรวจสอบเรื่องล่าสุดของท่าน',
      ].join('\n'),
    );
    return;
  }

  if (
    event.type === 'message' &&
    event.message?.type === 'text' &&
    event.replyToken &&
    userId
  ) {
    const text = event.message.text.trim();
    const referenceMatch = text.match(/CMP-\d{8}-\d{6}/i);

    if (text === 'สถานะ' || text.startsWith('ติดตาม') || referenceMatch) {
      const values = [userId];
      let condition = 'line_user_id = $1';

      if (referenceMatch) {
        values.push(referenceMatch[0].toUpperCase());
        condition += ' AND reference_no = $2';
      }

      const result = await pool.query(
        `SELECT reference_no, title, status, updated_at
           FROM complaints
          WHERE ${condition}
          ORDER BY created_at DESC
          LIMIT 1`,
        values,
      );

      if (result.rowCount === 0) {
        await replyTextMessage(
          event.replyToken,
          'ยังไม่พบเรื่องร้องเรียนของท่าน กรุณากดเมนู “แจ้งเรื่อง” เพื่อเริ่มต้น',
        );
        return;
      }

      const complaint = result.rows[0];
      await replyTextMessage(
        event.replyToken,
        [
          `เลขรับเรื่อง: ${complaint.reference_no}`,
          `เรื่อง: ${complaint.title}`,
          `สถานะ: ${getStatusLabel(complaint.status)}`,
        ].join('\n'),
      );
      return;
    }

    await replyTextMessage(
      event.replyToken,
      'กรุณากด Rich Menu เพื่อแจ้งเรื่อง หรือพิมพ์ “สถานะ” เพื่อติดตามเรื่องล่าสุด',
    );
  }
}

router.post('/', async (req, res) => {
  const signature = req.get('x-line-signature');
  const rawBody = req.body;

  if (!Buffer.isBuffer(rawBody) || !verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  for (const event of payload.events || []) {
    const eventId = event.webhookEventId || null;

    if (eventId) {
      const inserted = await pool.query(
        `INSERT INTO webhook_events (webhook_event_id, event_type, source_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (webhook_event_id) DO NOTHING
         RETURNING webhook_event_id`,
        [eventId, event.type || 'unknown', event.source?.userId || null],
      );
      if (inserted.rowCount === 0) {
        logger.info('duplicate_webhook_ignored', { webhookEventId: eventId });
        continue;
      }
    }

    try {
      await processEvent(event);
      if (eventId) {
        await pool.query(
          `UPDATE webhook_events
              SET processed_at = current_timestamp, processing_status = 'processed'
            WHERE webhook_event_id = $1`,
          [eventId],
        );
      }
    } catch (error) {
      logger.error('webhook_processing_error', {
        webhookEventId: eventId,
        eventType: event.type,
        error: error.message,
      });
      if (eventId) {
        await pool.query(
          `UPDATE webhook_events
              SET processed_at = current_timestamp,
                  processing_status = 'failed',
                  error_message = left($2, 2000)
            WHERE webhook_event_id = $1`,
          [eventId, error.message],
        );
      }
      // ตอบ 200 เพื่อป้องกันการ redelivery ซ้ำไม่จบ; ผู้ดูแลตรวจรายการ failed จากฐานข้อมูลได้
    }
  }

  return res.sendStatus(200);
});

export default router;
