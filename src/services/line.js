import crypto from 'node:crypto';
import config from '../config.js';
import { ApiError } from '../errors.js';

const LINE_API_BASE = 'https://api.line.me';

export async function verifyLineIdToken(idToken) {
  if (!config.lineLoginChannelId) {
    throw new ApiError(500, 'ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID');
  }

  const body = new URLSearchParams({
    id_token: idToken,
    client_id: config.lineLoginChannelId,
  });

  let response;
  try {
    response = await fetch(`${LINE_API_BASE}/oauth2/v2.1/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new ApiError(502, 'ไม่สามารถตรวจสอบตัวตนกับ LINE ได้ในขณะนี้');
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.sub) {
    const detail = result.error_description || result.error || 'invalid token';
    console.warn('[line] ID token verification failed:', detail);
    throw new ApiError(401, 'LINE ID Token ไม่ถูกต้อง หมดอายุ หรือมาจาก LINE Login Channel คนละรายการ');
  }

  if (String(result.aud) !== String(config.lineLoginChannelId)) {
    throw new ApiError(401, 'LINE ID Token ไม่ตรงกับ LINE_LOGIN_CHANNEL_ID ที่ตั้งค่าไว้');
  }

  return result;
}

export function verifyWebhookSignature(rawBody, receivedSignature) {
  if (!config.lineChannelSecret || !receivedSignature) return false;

  const expected = crypto
    .createHmac('sha256', config.lineChannelSecret)
    .update(rawBody)
    .digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(receivedSignature);

  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function callMessagingApi(path, body) {
  if (!config.lineChannelAccessToken) {
    if (!config.isProduction) {
      console.warn('LINE_CHANNEL_ACCESS_TOKEN is empty; message was not sent.');
      return null;
    }
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  }

  const response = await fetch(`${LINE_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.lineChannelAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE Messaging API error ${response.status}: ${detail}`);
  }

  return true;
}

export async function pushTextMessage(userId, text) {
  return callMessagingApi('/v2/bot/message/push', {
    to: userId,
    messages: [{ type: 'text', text }],
  });
}

export async function replyTextMessage(replyToken, text) {
  return callMessagingApi('/v2/bot/message/reply', {
    replyToken,
    messages: [{ type: 'text', text }],
  });
}
