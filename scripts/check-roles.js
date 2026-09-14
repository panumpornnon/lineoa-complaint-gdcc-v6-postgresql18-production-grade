// ตรวจสุขภาพ role/migration — รันด้วย: node scripts/check-roles.js
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');

try {
  const enumValues = await pool.query(
    `SELECT e.enumlabel
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'staff_role'
      ORDER BY e.enumsortorder`,
  );
  const labels = enumValues.rows.map((r) => r.enumlabel);
  console.log('staff_role enum ในฐานข้อมูล:', labels.join(', ') || '(ไม่พบ type)');
  for (const need of ['officer', 'supervisor', 'admin', 'exclusive', 'executive', 'dev']) {
    if (!labels.includes(need)) console.log(`  ❌ ขาดค่า '${need}'`);
  }

  const users = await pool.query(
    `SELECT role, count(*)::int AS total FROM staff_users GROUP BY role ORDER BY role`,
  );
  console.log('\nจำนวนผู้ใช้งานแยกตาม role:');
  for (const r of users.rows) console.log(`  ${r.role}: ${r.total}`);

  const applied = await pool.query(`SELECT filename, checksum FROM schema_migrations`);
  const appliedMap = new Map(applied.rows.map((r) => [r.filename, r.checksum]));
  const files = (await fs.readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();

  console.log('\nสถานะ migration:');
  for (const f of files) {
    const sql = await fs.readFile(path.join(sqlDir, f), 'utf8');
    const sum = crypto.createHash('sha256').update(sql).digest('hex');
    if (!appliedMap.has(f)) console.log(`  ⏳ ยังไม่ได้รัน: ${f}`);
    else if (appliedMap.get(f) !== sum) console.log(`  ⚠️  ไฟล์ถูกแก้หลังรันไปแล้ว (migrate จะหยุดที่นี่): ${f}`);
  }
  console.log('  (ไม่มีบรรทัดด้านบน = ครบและตรงกันทั้งหมด)');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
