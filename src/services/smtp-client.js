// ตัวส่งอีเมลผ่าน SMTP ที่เขียนขึ้นเอง ใช้เฉพาะโมดูลที่มากับ Node
//
// เหตุผลที่ไม่พึ่งแพ็กเกจภายนอก: เครื่อง server ของเทศบาลติดตั้งแพ็กเกจเพิ่มได้ยาก
// การมีโค้ดอยู่ในโปรเจกต์เองทำให้คัดลอกไฟล์ขึ้นเครื่องแล้วใช้งานได้ทันที
// ไม่ต้องรัน npm install และไม่ต้องมีอินเทอร์เน็ตบนเครื่องนั้น
//
// รองรับเท่าที่ระบบนี้ต้องใช้จริง
//   - STARTTLS (พอร์ต 587) และ TLS ตั้งแต่เริ่มเชื่อมต่อ (พอร์ต 465)
//   - ยืนยันตัวตนแบบ AUTH LOGIN และ AUTH PLAIN
//   - ส่งอีเมลสองรูปแบบในฉบับเดียว (ข้อความล้วน + HTML)
//   - หัวข้อและเนื้อหาภาษาไทย เข้ารหัสแบบ base64 ตามมาตรฐาน
// ไม่รองรับ: ไฟล์แนบ, ส่งหลายฉบับในการเชื่อมต่อเดียว, OAuth
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

const CRLF = '\r\n';

// แยกเฉพาะที่อยู่อีเมลออกจากรูปแบบ "ชื่อที่แสดง <a@b.com>"
// เพราะคำสั่ง MAIL FROM และ RCPT TO รับได้แต่ที่อยู่เปล่าๆ เท่านั้น
export function extractAddress(value) {
  const raw = String(value || '').trim();
  const match = /<([^>]+)>/.exec(raw);
  return (match ? match[1] : raw).trim();
}

// หัวข้ออีเมลที่มีอักขระนอก ASCII ต้องเข้ารหัสตาม RFC 2047
// ไม่เช่นนั้นภาษาไทยจะกลายเป็นตัวอักษรขยะในโปรแกรมอ่านเมลหลายตัว
function encodeHeaderValue(value) {
  const text = String(value || '');
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

// ชื่อผู้ส่งต้องเข้ารหัสเฉพาะส่วนชื่อ ส่วนที่อยู่ในวงเล็บแหลมต้องคงไว้อย่างเดิม
function encodeAddressHeader(value) {
  const raw = String(value || '').trim();
  const match = /^(.*)<([^>]+)>$/.exec(raw);
  if (!match) return raw;
  const name = match[1].trim().replace(/^"|"$/g, '');
  if (!name) return `<${match[2].trim()}>`;
  return `${encodeHeaderValue(name)} <${match[2].trim()}>`;
}

// แบ่งข้อความ base64 เป็นบรรทัดละ 76 ตัวอักษรตามที่มาตรฐานกำหนด
// เซิร์ฟเวอร์เมลบางตัวปฏิเสธบรรทัดที่ยาวเกิน 998 ตัวอักษร
function toBase64Lines(text) {
  const encoded = Buffer.from(String(text ?? ''), 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) || ['']).join(CRLF);
}

// บรรทัดที่ขึ้นต้นด้วยจุดต้องเติมจุดนำหน้าอีกตัว
// เพราะจุดเดี่ยวบนบรรทัดของตัวเองคือสัญญาณจบเนื้อหาในโปรโตคอล SMTP
function dotStuff(body) {
  return body.replace(/^\./gm, '..');
}

export function buildMessage({ from, to, subject, text, html, messageId, replyTo }) {
  const boundary = `----=_Part_${randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${encodeAddressHeader(from)}`,
    `To: ${encodeAddressHeader(to)}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    // บอกว่าเป็นข้อความที่ระบบสร้างขึ้นเอง ไม่ใช่คนพิมพ์ (RFC 3834)
    // ตัวกรองสแปมใช้แยกแยะจดหมายธุรกรรมออกจากจดหมายโฆษณา
    // และกันไม่ให้ระบบตอบกลับอัตโนมัติของปลายทางตอบกลับมาวนลูป
    'Auto-Submitted: auto-generated',
  ];

  // ที่อยู่สำหรับตอบกลับ ถ้าตั้งไว้ ควรเป็นกล่องจดหมายที่มีคนดูแลจริง
  // ผู้รับที่กดตอบกลับแล้วมีคนตอบ เป็นสัญญาณความน่าเชื่อถือที่ดีกว่ากล่องที่ไม่มีใครอ่าน
  if (replyTo) headers.splice(1, 0, `Reply-To: ${encodeAddressHeader(replyTo)}`);

  // ถ้ามีแต่ข้อความล้วน ไม่ต้องทำเป็นหลายส่วนให้ซับซ้อนเกินจำเป็น
  if (!html) {
    headers.push('Content-Type: text/plain; charset=UTF-8');
    headers.push('Content-Transfer-Encoding: base64');
    return `${headers.join(CRLF)}${CRLF}${CRLF}${toBase64Lines(text)}`;
  }

  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  // เรียงจากรูปแบบที่เรียบง่ายที่สุดไปซับซ้อนที่สุด
  // โปรแกรมอ่านเมลจะเลือกส่วนสุดท้ายที่ตัวเองแสดงได้ ตามข้อกำหนดของ multipart/alternative
  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      toBase64Lines(text),
    ].join(CRLF),
    [
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      toBase64Lines(html),
    ].join(CRLF),
    `--${boundary}--`,
  ];

  return `${headers.join(CRLF)}${CRLF}${CRLF}${parts.join(CRLF)}`;
}

// อ่านคำตอบจากเซิร์ฟเวอร์ คำตอบหนึ่งชุดอาจมีหลายบรรทัด
// บรรทัดที่ยังไม่จบจะเป็นรูปแบบ "250-ข้อความ" ส่วนบรรทัดสุดท้ายเป็น "250 ข้อความ"
class SmtpConnection {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.pending = null;
    this.closed = null;

    // ตั้งใจไม่เรียก setEncoding เพราะหลัง STARTTLS ต้องยก socket เดิมไปห่อด้วย TLS
    // ถ้าตั้งโหมดอ่านเป็นข้อความไว้ ชั้น TLS จะได้ข้อมูลที่ถูกแปลงไปแล้วและถอดรหัสไม่ออก
    this.onDataHandler = (chunk) => this.#onData(chunk.toString('utf8'));
    this.onErrorHandler = (error) => this.#fail(error);
    this.onCloseHandler = () =>
      this.#fail(new Error('เซิร์ฟเวอร์เมลปิดการเชื่อมต่อก่อนทำงานเสร็จ'));

    this.socket.on('data', this.onDataHandler);
    this.socket.on('error', this.onErrorHandler);
    this.socket.on('close', this.onCloseHandler);
  }

  #onData(chunk) {
    this.buffer += chunk;
    if (!this.pending) return;

    const match = /^\d{3} [^\r\n]*\r?\n/m.exec(this.buffer);
    if (!match) return;

    const endIndex = this.buffer.indexOf(match[0]) + match[0].length;
    const raw = this.buffer.slice(0, endIndex);
    this.buffer = this.buffer.slice(endIndex);

    const code = Number.parseInt(raw.slice(0, 3), 10);
    const { resolve, reject, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    // คืนค่าทั้งรหัสและข้อความ ผู้เรียกเป็นผู้ตัดสินว่ารหัสใดถือว่าสำเร็จ
    if (Number.isNaN(code)) reject(new Error(`เซิร์ฟเวอร์เมลตอบกลับในรูปแบบที่อ่านไม่ออก: ${raw.trim()}`));
    else resolve({ code, text: raw.trim() });
  }

  #fail(error) {
    this.closed = error;
    if (!this.pending) return;
    const { reject, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    reject(error);
  }

  read() {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`รอคำตอบจากเซิร์ฟเวอร์เมลเกิน ${this.timeoutMs} มิลลิวินาที`));
      }, this.timeoutMs);
      this.pending = { resolve, reject, timer };
      // เผื่อกรณีที่ข้อมูลมาถึงครบแล้วก่อนจะเรียก read
      this.#onData('');
    });
  }

  write(line) {
    this.socket.write(`${line}${CRLF}`);
  }

  // ส่งคำสั่งแล้วตรวจว่ารหัสตอบกลับอยู่ในกลุ่มที่ยอมรับได้หรือไม่
  async command(line, expected, { hideInError = false } = {}) {
    this.write(line);
    const reply = await this.read();
    if (!expected.includes(reply.code)) {
      const shown = hideInError ? '(ไม่แสดงเนื้อหาคำสั่งเพราะมีข้อมูลลับ)' : line;
      throw new Error(`คำสั่ง ${shown} ไม่สำเร็จ เซิร์ฟเวอร์ตอบ: ${reply.text}`);
    }
    return reply;
  }

  // ถอดตัวดักเหตุการณ์ออกโดยไม่ปิดการเชื่อมต่อ ใช้ตอนยก socket เดิมไปห่อด้วย TLS
  // ต่างจาก end() ที่ปิดและทำลาย socket ทิ้ง
  detach() {
    this.socket.off('data', this.onDataHandler);
    this.socket.off('error', this.onErrorHandler);
    this.socket.off('close', this.onCloseHandler);
    const leftover = this.buffer;
    this.buffer = '';
    return leftover;
  }

  end() {
    this.detach();
    this.socket.end();
    this.socket.destroy();
  }
}

function connectPlain(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`เชื่อมต่อ ${host}:${port} ไม่สำเร็จภายใน ${timeoutMs} มิลลิวินาที`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function upgradeToTls(socket, host, timeoutMs, rejectUnauthorized) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host, rejectUnauthorized });
    const timer = setTimeout(() => {
      secureSocket.destroy();
      reject(new Error(`เริ่มการเข้ารหัส TLS ไม่สำเร็จภายใน ${timeoutMs} มิลลิวินาที`));
    }, timeoutMs);
    secureSocket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(secureSocket);
    });
    secureSocket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function parseExtensions(ehloText) {
  return new Set(
    ehloText
      .split(/\r?\n/)
      .map((line) => line.slice(4).trim().toUpperCase())
      .filter(Boolean),
  );
}

async function authenticate(connection, extensions, user, pass) {
  const authLine = [...extensions].find((line) => line.startsWith('AUTH'));
  const methods = authLine ? authLine.split(/\s+/).slice(1) : [];

  // AUTH LOGIN รองรับกว้างที่สุด จึงเลือกเป็นลำดับแรก
  if (!methods.length || methods.includes('LOGIN')) {
    await connection.command('AUTH LOGIN', [334]);
    await connection.command(Buffer.from(user, 'utf8').toString('base64'), [334], {
      hideInError: true,
    });
    await connection.command(Buffer.from(pass, 'utf8').toString('base64'), [235], {
      hideInError: true,
    });
    return;
  }

  if (methods.includes('PLAIN')) {
    const payload = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
    await connection.command(`AUTH PLAIN ${payload}`, [235], { hideInError: true });
    return;
  }

  throw new Error(`เซิร์ฟเวอร์เมลไม่รองรับวิธียืนยันตัวตนที่ระบบนี้ใช้ได้ (รองรับ: ${methods.join(', ')})`);
}

export async function sendMailOverSmtp({
  host,
  port = 587,
  secure = false,
  user = '',
  pass = '',
  from,
  to,
  subject,
  text,
  html,
  timeoutMs = 20_000,
  rejectUnauthorized = true,
  heloName = '',
  replyTo = '',
}) {
  if (!host) throw new Error('ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์เมล (SMTP_HOST)');
  if (!from) throw new Error('ยังไม่ได้ตั้งค่าผู้ส่ง (SMTP_FROM)');
  if (!to) throw new Error('ไม่ได้ระบุอีเมลปลายทาง');

  // ชื่อที่ใช้แนะนำตัวตอน EHLO ควรเป็นชื่อเต็มที่ตรวจย้อนกลับได้จริง
  // เซิร์ฟเวอร์เมลหลายแห่งลดคะแนนความน่าเชื่อถือเมื่อเจอชื่อเครื่องสั้นๆ
  // ที่ไม่ใช่ชื่อโดเมน เช่น SURAT-SRV01 ซึ่งเป็นค่าปริยายบน Windows
  const hostname = heloName || os.hostname() || 'localhost';
  const senderAddress = extractAddress(from);
  const messageId = `<${randomBytes(16).toString('hex')}@${senderAddress.split('@')[1] || hostname}>`;

  let socket = secure
    ? await upgradeToTls(await connectPlain(host, port, timeoutMs), host, timeoutMs, rejectUnauthorized)
    : await connectPlain(host, port, timeoutMs);

  let connection = new SmtpConnection(socket, timeoutMs);

  try {
    const greeting = await connection.read();
    if (greeting.code !== 220) {
      throw new Error(`เซิร์ฟเวอร์เมลไม่พร้อมใช้งาน: ${greeting.text}`);
    }

    let ehlo = await connection.command(`EHLO ${hostname}`, [250]);
    let extensions = parseExtensions(ehlo.text);

    // พอร์ต 587 ต้องยกระดับเป็นการเชื่อมต่อแบบเข้ารหัสก่อนส่งรหัสผ่านเสมอ
    // ถ้าข้ามขั้นนี้ รหัสผ่านจะวิ่งบนเครือข่ายแบบอ่านได้ด้วยตาเปล่า
    if (!secure && extensions.has('STARTTLS')) {
      await connection.command('STARTTLS', [220]);
      // ต้องถอดตัวดักเหตุการณ์ออกก่อน แต่ห้ามปิด socket เพราะต้องใช้เส้นเดิมต่อ
      const leftover = connection.detach();
      if (leftover.trim()) {
        throw new Error('เซิร์ฟเวอร์เมลส่งข้อมูลเกินมาก่อนเริ่มเข้ารหัส อาจถูกดักกลางทาง');
      }
      socket = await upgradeToTls(socket, host, timeoutMs, rejectUnauthorized);
      connection = new SmtpConnection(socket, timeoutMs);
      ehlo = await connection.command(`EHLO ${hostname}`, [250]);
      extensions = parseExtensions(ehlo.text);
    } else if (!secure && user) {
      throw new Error(
        'เซิร์ฟเวอร์เมลไม่รองรับ STARTTLS จึงส่งรหัสผ่านอย่างปลอดภัยไม่ได้ กรุณาใช้พอร์ต 465 พร้อม SMTP_SECURE=true',
      );
    }

    if (user) await authenticate(connection, extensions, user, pass);

    await connection.command(`MAIL FROM:<${senderAddress}>`, [250]);
    await connection.command(`RCPT TO:<${extractAddress(to)}>`, [250, 251]);
    await connection.command('DATA', [354]);

    const message = buildMessage({ from, to, subject, text, html, messageId, replyTo });
    connection.socket.write(`${dotStuff(message)}${CRLF}.${CRLF}`);

    const accepted = await connection.read();
    if (accepted.code !== 250) {
      throw new Error(`เซิร์ฟเวอร์เมลไม่รับข้อความ: ${accepted.text}`);
    }

    // ส่ง QUIT แบบไม่สนคำตอบ เพราะข้อความถูกรับไว้เรียบร้อยแล้ว
    try {
      await connection.command('QUIT', [221]);
    } catch {
      /* ไม่เป็นไร */
    }

    return { messageId };
  } finally {
    connection.end();
  }
}
