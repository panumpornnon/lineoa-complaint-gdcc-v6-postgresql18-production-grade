// บริการส่งอีเมล ใช้ส่งรหัสยืนยันเมื่อขอตั้งรหัสผ่านใหม่
//
// ออกแบบให้ระบบทำงานได้ตามปกติแม้ยังไม่ได้ตั้งค่า SMTP หรือยังไม่ได้ติดตั้ง
// nodemailer เพราะเทศบาลยังไม่ได้เปิดพอร์ตให้ใช้งาน จึงไม่ import ไว้ที่หัวไฟล์
// แต่เรียกแบบ dynamic ตอนจะส่งจริง ถ้าไม่มีแพ็กเกจก็แจ้งกลับว่าส่งไม่ได้
// โดยไม่ทำให้เซิร์ฟเวอร์เริ่มทำงานไม่ขึ้น
import config from '../config.js';
import { logger } from '../logger.js';

let transportPromise = null;

export function isMailConfigured() {
  return Boolean(config.smtpHost && config.smtpFrom);
}

async function getTransport() {
  if (!isMailConfigured()) return null;
  if (transportPromise) return transportPromise;

  transportPromise = (async () => {
    let nodemailer;
    try {
      nodemailer = (await import('nodemailer')).default;
    } catch {
      logger.error('mailer_package_missing', {
        hint: 'ยังไม่ได้ติดตั้ง nodemailer — รัน npm install ก่อน',
      });
      return null;
    }

    return nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      // ถ้าเซิร์ฟเวอร์เมลไม่ต้องยืนยันตัวตน ให้เว้น SMTP_USER ไว้
      ...(config.smtpUser
        ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  })();

  return transportPromise;
}

// คืนค่าเป็นผลลัพธ์เสมอ ไม่โยนข้อผิดพลาดออกไป
// เพราะผู้เรียกต้องตัดสินใจต่อได้ว่าจะแสดงรหัสบนหน้าจอแทนหรือไม่
export async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const transport = await getTransport();
  if (!transport) {
    return { sent: false, reason: 'package_missing' };
  }

  try {
    await transport.sendMail({
      from: config.smtpFrom,
      to,
      subject,
      // ส่งทั้งสองรูปแบบในฉบับเดียว โปรแกรมอ่านเมลจะเลือกเอง
      // ตัวที่อ่าน HTML ไม่ได้ หรือผู้ใช้ปิดการแสดง HTML ไว้ ก็ยังอ่าน text ได้ครบ
      text,
      ...(html ? { html } : {}),
    });
    logger.info('mail_sent', { subject });
    return { sent: true };
  } catch (error) {
    // ไม่บันทึกเนื้อหาอีเมลลง log เพราะมีรหัสยืนยันอยู่ข้างใน
    logger.error('mail_send_failed', { error: error.message, subject });
    return { sent: false, reason: 'send_failed', message: error.message };
  }
}

// กันอักขระพิเศษไม่ให้หลุดเข้าไปในโครงสร้าง HTML ของอีเมล
// ชื่อผู้ใช้มาจากฐานข้อมูลซึ่งผู้ดูแลเป็นคนกรอก จึงยังต้องถือว่าเป็นข้อมูลที่ไว้ใจไม่ได้
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ข้อความอีเมลแจ้งรหัสยืนยัน แยกออกมาเพื่อให้แก้ถ้อยคำได้ที่เดียว
//
// ส่งเป็นอีเมลสองรูปแบบในฉบับเดียว (text + html)
// ฝั่ง html ใส่ target="_blank" ให้ลิงก์ จึงเปิดในแท็บใหม่โดยไม่ทับหน้าที่ผู้ใช้เปิดค้างไว้
// พร้อม rel="noopener noreferrer" ซึ่งจำเป็นเสมอเมื่อใช้ target="_blank"
// เพื่อไม่ให้หน้าปลายทางเข้าถึงหน้าต้นทางผ่าน window.opener ได้
export function buildPasswordResetMail({ displayName, code, minutes, resetUrl }) {
  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(resetUrl || '');

  const html = `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <!-- โปรแกรมอ่านเมลบางตัวไม่สนใจ target ที่แท็ก a แต่ยอมทำตาม base
         ใส่ไว้ทั้งสองที่จึงครอบคลุมกว่า -->
    <base target="_blank" />
  </head>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:'Segoe UI',Tahoma,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;color:#0b695b;font-weight:700;">PASSWORD RESET</p>
      <h1 style="margin:0 0 20px;font-size:20px;">ตั้งรหัสผ่านใหม่</h1>

      <p style="margin:0 0 8px;line-height:1.7;">เรียน ${safeName}</p>
      <p style="margin:0 0 20px;line-height:1.7;">
        มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชีของท่านในระบบรับเรื่องร้องเรียน
        เทศบาลนครสุราษฎร์ธานี กรุณากดปุ่มด้านล่างแล้วกรอกรหัสยืนยัน
      </p>

      <p style="margin:0 0 6px;font-size:13px;color:#64748b;">รหัสยืนยัน</p>
      <p style="margin:0 0 20px;font-size:30px;font-weight:700;letter-spacing:.18em;font-family:Consolas,monospace;">${escapeHtml(code)}</p>

      ${
        resetUrl
          ? `<p style="margin:0 0 20px;">
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
           style="display:inline-block;padding:12px 22px;background:#0b695b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
          เปิดหน้าตั้งรหัสผ่านใหม่
        </a>
      </p>
      <p style="margin:0 0 20px;font-size:12px;color:#64748b;word-break:break-all;">
        หากกดปุ่มไม่ได้ ให้คัดลอกที่อยู่นี้ไปวางในเบราว์เซอร์<br />
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:#0b695b;">${safeUrl}</a>
      </p>`
          : ''
      }

      <p style="margin:0 0 20px;line-height:1.7;">
        รหัสนี้ใช้ได้ภายใน <b>${escapeHtml(minutes)} นาที</b> และใช้ได้เพียงครั้งเดียว
      </p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;" />
      <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.7;">
        หากท่านไม่ได้เป็นผู้ขอ กรุณาแจ้งผู้ดูแลระบบทันที และไม่ต้องดำเนินการใดๆ กับรหัสนี้
      </p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ</p>
    </div>
  </body>
</html>`;

  return {
    subject: 'รหัสยืนยันสำหรับตั้งรหัสผ่านใหม่ — ระบบรับเรื่องร้องเรียน',
    html,
    text: [
      `เรียน ${displayName}`,
      '',
      'มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชีของท่านในระบบรับเรื่องร้องเรียน',
      'เทศบาลนครสุราษฎร์ธานี กรุณาเปิดลิงก์ด้านล่างแล้วกรอกรหัสยืนยัน',
      '',
      ...(resetUrl ? [`ลิงก์ : ${resetUrl}`, ''] : []),
      `รหัสยืนยัน : ${code}`,
      '',
      `รหัสนี้ใช้ได้ภายใน ${minutes} นาที และใช้ได้เพียงครั้งเดียว`,
      '',
      'หากท่านไม่ได้เป็นผู้ขอ กรุณาแจ้งผู้ดูแลระบบทันที',
      'และไม่ต้องดำเนินการใดๆ กับรหัสนี้',
      '',
      'อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ',
    ].join('\n'),
  };
}
