// สคริปต์ทดสอบการส่งอีเมล
//
//   npm run mail:test somebody@example.com
//
// เรียกผ่าน sendMail() ตัวเดียวกับที่ระบบใช้จริง จึงทดสอบเส้นทางเดียวกันทั้งหมด
// รวมถึงการเลือกวิธีส่งอัตโนมัติ (nodemailer ถ้ามี มิฉะนั้นใช้ตัวที่เขียนเอง)
//
// สคริปต์นี้ไม่แตะฐานข้อมูลและไม่แตะบัญชีผู้ใช้ใดๆ ใช้ตรวจเส้นทางการส่งอีเมลอย่างเดียว
import { randomInt } from 'node:crypto';
import config from '../src/config.js';
import { buildPasswordResetMail, isMailConfigured, sendMail } from '../src/services/mailer.js';

const recipient = process.argv[2];

if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error('\nกรุณาระบุอีเมลปลายทาง เช่น');
  console.error('  npm run mail:test your-name@example.com\n');
  process.exit(1);
}

if (!isMailConfigured()) {
  console.error('\nยังไม่ได้ตั้งค่าเซิร์ฟเวอร์เมลใน .env');
  console.error('ต้องมีอย่างน้อย SMTP_HOST และ SMTP_FROM\n');
  process.exit(1);
}

// ตรวจว่าจะใช้วิธีไหนส่ง เพื่อให้ผู้ทดสอบรู้ว่ากำลังทดสอบเส้นทางใดอยู่
let via = config.smtpTransport;
if (!via) {
  try {
    await import('nodemailer');
    via = 'nodemailer (ติดตั้งไว้ในเครื่องนี้)';
  } catch {
    via = 'builtin (ตัวส่ง SMTP ที่เขียนไว้ในโปรเจกต์)';
  }
}

console.log('\nโหมด: ส่งผ่านเซิร์ฟเวอร์ที่ตั้งค่าไว้');
console.log(`  host    : ${config.smtpHost}:${config.smtpPort}`);
console.log(`  secure  : ${config.smtpSecure}`);
console.log(`  user    : ${config.smtpUser || '(ไม่ได้ใช้การยืนยันตัวตน)'}`);
console.log(`  from    : ${config.smtpFrom}`);
console.log(`  วิธีส่ง   : ${via}`);

// รหัสตัวอย่างสำหรับทดสอบเท่านั้น ไม่ได้บันทึกลงฐานข้อมูล จึงใช้เข้าระบบไม่ได้
const sampleCode = String(randomInt(0, 100_000_000)).padStart(8, '0');

const mail = buildPasswordResetMail({
  displayName: 'ทดสอบระบบ',
  code: sampleCode,
  minutes: config.passwordResetCodeMinutes,
  resetUrl: `${config.appBaseUrl || `http://localhost:${config.port}`}/admin.html?reset=1`,
});

const outcome = await sendMail({ to: recipient, ...mail });

if (!outcome.sent) {
  console.error(`\nส่งอีเมลไม่สำเร็จ (${outcome.reason})`);
  if (outcome.message) console.error(`  ${outcome.message}`);
  console.error('\nสาเหตุที่พบบ่อย: พอร์ตถูกปิดที่ไฟร์วอลล์ ชื่อผู้ใช้หรือรหัสผ่านผิด');
  console.error('หรือเลือก SMTP_PORT กับ SMTP_SECURE ไม่เข้าคู่กัน (587+false หรือ 465+true)\n');
  process.exit(1);
}

console.log(`\nส่งถึง ${recipient} เรียบร้อย`);
if (outcome.messageId) console.log(`  messageId : ${outcome.messageId}`);
console.log(`\nรหัสตัวอย่างในอีเมลฉบับนี้คือ ${sampleCode}`);
console.log('เป็นรหัสสำหรับดูหน้าตาอีเมลเท่านั้น ไม่ได้บันทึกลงฐานข้อมูล จึงใช้เข้าระบบไม่ได้\n');
