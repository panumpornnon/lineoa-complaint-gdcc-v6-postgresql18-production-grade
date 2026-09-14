import { Router } from 'express';
import config from '../config.js';
import { pool } from '../db.js';

const router = Router();

const ALLOWED_LINE_IMAGE_HOSTS = new Set([
  'profile.line-scdn.net',
  'obs.line-scdn.net',
]);

function isAllowedLineImageUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (ALLOWED_LINE_IMAGE_HOSTS.has(url.hostname) || url.hostname.endsWith('.line-scdn.net'))
    );
  } catch {
    return false;
  }
}


router.get('/config', (req, res) => {
  res.json({
    liffId: config.liffId,
    privacyPolicyUrl: config.privacyPolicyUrl,
    googleMapsApiKey: config.googleMapsApiKey,
    devBypassLineAuth: config.devBypassLineAuth,
    uploadLimits: {
      maxFiles: config.maxUploadFiles,
      maxFileMb: config.maxUploadMb,
    },
  });
});


router.get('/line/profile-image', async (req, res) => {
  const source = typeof req.query.url === 'string' ? req.query.url.trim() : '';

  if (!source || !isAllowedLineImageUrl(source)) {
    return res.status(400).json({ success: false, message: 'LINE profile image URL ไม่ถูกต้อง' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(source, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': 'SmartCity-LIFF-Profile-Proxy/1.0',
      },
    });

    if (!response.ok || !isAllowedLineImageUrl(response.url)) {
      return res.status(502).json({ success: false, message: 'ไม่สามารถโหลดรูปโปรไฟล์ LINE ได้' });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return res.status(415).json({ success: false, message: 'ข้อมูลที่ได้รับไม่ใช่รูปภาพ' });
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 5 * 1024 * 1024) {
      return res.status(413).json({ success: false, message: 'รูปโปรไฟล์มีขนาดใหญ่เกินไป' });
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 5 * 1024 * 1024) {
      return res.status(413).json({ success: false, message: 'รูปโปรไฟล์มีขนาดใหญ่เกินไป' });
    }

    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'private, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    return res.send(body);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ success: false, message: 'โหลดรูปโปรไฟล์ LINE หมดเวลา' });
    }
    return res.status(502).json({ success: false, message: 'ไม่สามารถโหลดรูปโปรไฟล์ LINE ได้' });
  } finally {
    clearTimeout(timeout);
  }
});

router.get('/categories', async (req, res) => {
  const result = await pool.query(
    `SELECT id, code, name_th
       FROM complaint_categories
      WHERE is_active = true
      ORDER BY sort_order, name_th`,
  );

  res.json({ success: true, data: result.rows });
});

export default router;
