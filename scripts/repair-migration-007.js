// ซ่อมแถว migration 007 ที่ checksum ไม่ตรงกับไฟล์ (เกิดจากไฟล์เคยถูกเขียนทับแล้ว restore กลับ)
//
// วิธีใช้: ตั้ง Start Command บน Render เป็น
//   node scripts/repair-migration-007.js && npm start
// deploy ผ่านแล้ว "เปลี่ยนกลับเป็น npm start ทันที"
//
// สคริปต์นี้ปลอดภัย: ลบเฉพาะแถวที่ checksum ไม่ตรงจริงเท่านั้น
// รันซ้ำไม่มีผลอะไร และไม่แตะข้อมูลผู้ใช้
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const TARGET = '007_workflow_alignment.sql';
const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');

try {
  const sql = await fs.readFile(path.join(sqlDir, TARGET), 'utf8');
  const fileChecksum = crypto.createHash('sha256').update(sql).digest('hex');

  const applied = await pool.query(
    'SELECT checksum FROM schema_migrations WHERE filename = $1',
    [TARGET],
  );

  if (applied.rowCount === 0) {
    console.log(`[repair-007] ไม่มีแถว ${TARGET} ใน schema_migrations อยู่แล้ว ไม่ต้องทำอะไร`);
  } else if (applied.rows[0].checksum === fileChecksum) {
    console.log(`[repair-007] checksum ตรงกับไฟล์แล้ว ไม่ต้องทำอะไร`);
  } else {
    console.log(`[repair-007] พบ checksum ไม่ตรง`);
    console.log(`[repair-007]   ในฐานข้อมูล: ${applied.rows[0].checksum}`);
    console.log(`[repair-007]   ของไฟล์จริง: ${fileChecksum}`);
    await pool.query('DELETE FROM schema_migrations WHERE filename = $1', [TARGET]);
    console.log(`[repair-007] ลบแถวแล้ว — migrate.js จะรัน ${TARGET} ใหม่ในขั้นตอนถัดไป`);
  }
} catch (error) {
  console.error('[repair-007] ล้มเหลว:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
