// สร้างไฟล์ migration จากข้อมูลหน่วยงานและหมวดหมู่ที่มีอยู่จริงในฐานข้อมูล
//
// ใช้เมื่อเพิ่มหรือแก้หน่วยงาน/หมวดหมู่ผ่านหน้าเว็บแล้วต้องการให้ข้อมูลนั้น
// ติดไปกับโค้ด เพื่อให้ฐานข้อมูลตัวอื่น (dev, test, เครื่องใหม่) ได้ข้อมูล
// ชุดเดียวกันโดยไม่ต้องมานั่งกรอกซ้ำ
//
// วิธีใช้:
//   node scripts/export-governance-migration.js
//
// จะอ่านฐานข้อมูลที่ DATABASE_URL ชี้อยู่ แล้วเขียนไฟล์ใหม่ใน sql/
// โดยตั้งเลขลำดับต่อจากไฟล์ล่าสุดให้อัตโนมัติ
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');

// escape single quote สำหรับ string literal ของ Postgres
function q(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function nextMigrationNumber() {
  const files = await fs.readdir(sqlDir);
  const numbers = files
    .filter((name) => name.endsWith('.sql'))
    .map((name) => Number.parseInt(name.slice(0, 3), 10))
    .filter((value) => Number.isFinite(value));
  const max = numbers.length ? Math.max(...numbers) : 0;
  return String(max + 1).padStart(3, '0');
}

try {
  const departments = await pool.query(
    `SELECT code, name_th, is_active
       FROM departments
      ORDER BY code`,
  );

  const categories = await pool.query(
    `SELECT c.code,
            c.name_th,
            c.sla_hours,
            c.is_active,
            c.sort_order,
            d.code AS department_code
       FROM complaint_categories c
       LEFT JOIN departments d ON d.id = c.department_id
      ORDER BY c.sort_order, c.code`,
  );

  const number = await nextMigrationNumber();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${number}_sync_governance_data.sql`;

  const lines = [];
  lines.push(`-- ${filename}`);
  lines.push(`-- สร้างอัตโนมัติโดย scripts/export-governance-migration.js เมื่อ ${stamp}`);
  lines.push('--');
  lines.push('-- ซิงก์หน่วยงานและหมวดหมู่ให้ตรงกับฐานข้อมูลต้นทางที่ใช้สร้างไฟล์นี้');
  lines.push('-- ใช้ ON CONFLICT DO UPDATE จึงรันซ้ำได้ และจะเขียนทับชื่อ/SLA/สถานะ');
  lines.push('-- ของรายการที่มีรหัสตรงกันอยู่แล้ว');
  lines.push('--');
  lines.push('-- หมายเหตุ: ไฟล์นี้ไม่ลบรายการที่ไม่มีในต้นทาง เพื่อไม่ให้ข้อมูลของ');
  lines.push('-- สภาพแวดล้อมอื่นหายโดยไม่ตั้งใจ หากต้องการลบให้เขียน migration แยก');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  lines.push('-- ===== หน่วยงาน =====');
  if (departments.rowCount) {
    lines.push('INSERT INTO departments (code, name_th, is_active) VALUES');
    lines.push(
      departments.rows
        .map((r) => `  (${q(r.code)}, ${q(r.name_th)}, ${r.is_active})`)
        .join(',\n'),
    );
    lines.push('ON CONFLICT (code) DO UPDATE SET');
    lines.push('  name_th = EXCLUDED.name_th,');
    lines.push('  is_active = EXCLUDED.is_active;');
  } else {
    lines.push('-- (ไม่มีข้อมูลหน่วยงานในฐานข้อมูลต้นทาง)');
  }
  lines.push('');

  lines.push('-- ===== หมวดหมู่และ SLA =====');
  if (categories.rowCount) {
    lines.push('INSERT INTO complaint_categories (code, name_th, sla_hours, is_active, sort_order) VALUES');
    lines.push(
      categories.rows
        .map(
          (r) =>
            `  (${q(r.code)}, ${q(r.name_th)}, ${r.sla_hours}, ${r.is_active}, ${r.sort_order})`,
        )
        .join(',\n'),
    );
    lines.push('ON CONFLICT (code) DO UPDATE SET');
    lines.push('  name_th = EXCLUDED.name_th,');
    lines.push('  sla_hours = EXCLUDED.sla_hours,');
    lines.push('  is_active = EXCLUDED.is_active,');
    lines.push('  sort_order = EXCLUDED.sort_order;');
    lines.push('');

    // ผูกหมวดหมู่กับหน่วยงาน โดยอ้างด้วย code ไม่ใช่ uuid
    // เพราะ uuid ของแต่ละฐานข้อมูลไม่ตรงกัน
    lines.push('-- ===== ผูกหมวดหมู่กับหน่วยงานรับผิดชอบ =====');
    lines.push('-- อ้างอิงด้วยรหัส ไม่ใช่ uuid เพราะ uuid ของแต่ละฐานข้อมูลไม่ตรงกัน');
    const linked = categories.rows.filter((r) => r.department_code);
    if (linked.length) {
      for (const r of linked) {
        lines.push('UPDATE complaint_categories c');
        lines.push('   SET department_id = d.id');
        lines.push('  FROM departments d');
        lines.push(` WHERE c.code = ${q(r.code)} AND d.code = ${q(r.department_code)};`);
      }
    } else {
      lines.push('-- (ยังไม่มีหมวดหมู่ใดผูกกับหน่วยงาน)');
    }
  } else {
    lines.push('-- (ไม่มีข้อมูลหมวดหมู่ในฐานข้อมูลต้นทาง)');
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  const target = path.join(sqlDir, filename);
  await fs.writeFile(target, lines.join('\n'), 'utf8');

  console.log(`สร้างไฟล์แล้ว: sql/${filename}`);
  console.log(`  หน่วยงาน  ${departments.rowCount} รายการ`);
  console.log(`  หมวดหมู่  ${categories.rowCount} รายการ`);
  console.log('');
  console.log('ขั้นตอนต่อไป: เปิดไฟล์ตรวจความถูกต้อง แล้ว commit เข้า git');
  console.log('ฐานข้อมูลอื่นจะได้ข้อมูลชุดนี้เมื่อรัน npm run db:migrate');
} catch (error) {
  console.error('สร้าง migration ไม่สำเร็จ:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
