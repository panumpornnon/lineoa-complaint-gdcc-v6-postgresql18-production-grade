// สคริปต์ทดสอบการส่งอีเมล
//
//   npm run mail:test somebody@example.com
//
// มีสองโหมด ตัดสินจากค่าใน .env โดยอัตโนมัติ
//   1. ตั้ง SMTP_HOST ไว้แล้ว  -> ส่งผ่านเซิร์ฟเวอร์จริงตามที่ตั้งค่าไว้
//   2. ยังไม่ได้ตั้ง SMTP_HOST -> สร้างบัญชีทดสอบของ Ethereal ให้เองแบบชั่วคราว
//      (https://ethereal.email/) อีเมลจะไม่ถูกส่งออกไปข้างนอกจริง
//      แต่ค้างอยู่ในกล่องบนเว็บ แล้วสคริปต์จะพิมพ์ลิงก์สำหรับเปิดดูให้
//
// สคริปต์นี้ไม่แตะฐานข้อมูลและไม่แตะบัญชีผู้ใช้ใดๆ ใช้ตรวจเส้นทางการส่งอีเมลอย่างเดียว
import config from '../src/config.js';
import { buildPasswordResetMail } from '../src/services/mailer.js';

const recipient = process.argv[2];

if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error('\nกรุณาระบุอีเมลปลายทาง เช่น');
  console.error('  npm run mail:test your-name@example.com\n');
  process.exit(1);
}

let nodemailer;
try {
  nodemailer = (await import('nodemailer')).default;
} catch {
  console.error('\nยังไม่ได้ติดตั้ง nodemailer — รัน npm install ก่อน\n');
  process.exit(1);
}

// รหัสตัวอย่างสำหรับทดสอบเท่านั้น ไม่ได้บันทึกลงฐานข้อมูล จึงใช้เข้าระบบไม่ได้
const sampleCode = String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');

const mail = buildPasswordResetMail({
  displayName: 'ทดสอบระบบ',
  code: sampleCode,
  minutes: config.passwordResetCodeMinutes,
  resetUrl: `${config.appBaseUrl || `http://localhost:${config.port}`}/admin.html?reset=1`,
});

let transport;
let from = config.smtpFrom;
let usingEthereal = false;

if (config.smtpHost) {
  console.log('\nโหมด: ส่งผ่านเซิร์ฟเวอร์จริงที่ตั้งค่าไว้');
  console.log(`  host   : ${config.smtpHost}:${config.smtpPort}`);
  console.log(`  secure : ${config.smtpSecure}`);
  console.log(`  user   : ${config.smtpUser || '(ไม่ได้ใช้การยืนยันตัวตน)'}`);

  if (!config.smtpFrom) {
    console.error('\nยังไม่ได้ตั้ง SMTP_FROM ใน .env จึงไม่รู้ว่าจะส่งในนามใคร\n');
    process.exit(1);
  }

  transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    ...(config.smtpUser
      ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
} else {
  usingEthereal = true;
  console.log('\nยังไม่ได้ตั้ง SMTP_HOST ใน .env');
  console.log('กำลังสร้างบัญชีทดสอบชั่วคราวจาก Ethereal (อีเมลจะไม่ถูกส่งออกไปจริง)...');

  let account;
  try {
    account = await nodemailer.createTestAccount();
  } catch (error) {
    console.error(`\nสร้างบัญชีทดสอบไม่สำเร็จ: ${error.message}`);
    console.error('ตรวจว่าเครื่องนี้ออกอินเทอร์เน็ตได้ หรือสมัครเองที่ https://ethereal.email/\n');
    process.exit(1);
  }

  from = config.smtpFrom || `ระบบรับเรื่องร้องเรียน (ทดสอบ) <${account.user}>`;

  console.log('\nค่าที่ได้ ถ้าต้องการให้ทั้งระบบวิ่งผ่าน Ethereal ให้นำไปใส่ใน .env');
  console.log('  SMTP_HOST=smtp.ethereal.email');
  console.log('  SMTP_PORT=587');
  console.log('  SMTP_SECURE=false');
  console.log(`  SMTP_USER=${account.user}`);
  console.log(`  SMTP_PASSWORD=${account.pass}`);
  console.log('  (บัญชีนี้เป็นของชั่วคราว ใช้ทดสอบเท่านั้น ห้ามใช้บนเครื่อง server จริง)');

  transport = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: account.user, pass: account.pass },
  });
}

try {
  await transport.verify();
  console.log('\nเชื่อมต่อเซิร์ฟเวอร์เมลสำเร็จ');
} catch (error) {
  console.error(`\nเชื่อมต่อเซิร์ฟเวอร์เมลไม่สำเร็จ: ${error.message}`);
  console.error('สาเหตุที่พบบ่อย: พอร์ตถูกปิดที่ไฟร์วอลล์ ชื่อผู้ใช้หรือรหัสผ่านผิด');
  console.error('หรือเลือก SMTP_PORT กับ SMTP_SECURE ไม่เข้าคู่กัน (587+false หรือ 465+true)\n');
  process.exit(1);
}

try {
  const info = await transport.sendMail({ from, to: recipient, ...mail });
  console.log(`ส่งถึง ${recipient} เรียบร้อย (messageId: ${info.messageId})`);

  if (usingEthereal) {
    console.log('\nเปิดลิงก์นี้เพื่ออ่านอีเมลที่ส่ง (ไม่มีใครได้รับจริง)');
    console.log(`  ${nodemailer.getTestMessageUrl(info)}`);
  }

  console.log(`\nรหัสตัวอย่างในอีเมลฉบับนี้คือ ${sampleCode}`);
  console.log('เป็นรหัสสำหรับดูหน้าตาอีเมลเท่านั้น ไม่ได้บันทึกลงฐานข้อมูล จึงใช้เข้าระบบไม่ได้\n');
} catch (error) {
  console.error(`\nส่งอีเมลไม่สำเร็จ: ${error.message}\n`);
  process.exit(1);
}
