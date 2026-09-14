// สร้างไฟล์ migration จากข้อมูลหลังบ้านที่มีอยู่จริงในฐานข้อมูล
//
// ครอบคลุม 3 ตาราง: departments, complaint_categories, staff_profiles
// ไม่ครอบ staff_users เพราะมี password_hash ซึ่งห้ามส่งออกเด็ดขาด
//
// ใช้เมื่อเพิ่มหรือแก้ข้อมูลหลังบ้านผ่านหน้าเว็บแล้วต้องการให้ข้อมูลนั้น
// ติดไปกับโค้ด เพื่อให้ฐานข้อมูลตัวอื่น (dev, test, GDCC) ได้ข้อมูล
// ชุดเดียวกันโดยไม่ต้องมานั่งกรอกซ้ำ
//
// วิธีใช้:
//   npm run db:export-governance
//
// สำคัญ: git pull ก่อนรันเสมอ เพื่อไม่ให้เลขไฟล์ชนกับเครื่องอื่น
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlDir = path.join(rootDir, 'sql');

// escape single quote สำหรับ string literal ของ Postgres
function q(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

// เติม ::varchar ให้แถวแรกของ VALUES เพื่อให้ Postgres รู้ชนิดข้อมูลแน่นอน
function qTyped(value) {
  return `${q(value)}::varchar`;
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

// เตือนถ้ามีไฟล์ .sql ที่ยังไม่ commit เพราะแปลว่าเลขล่าสุดอาจยังไม่ตรงกับ git
function warnUncommittedSql() {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', 'sql'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pending = out.split('\n').map((l) => l.trim()).filter(Boolean);
    if (pending.length) {
      console.warn('');
      console.warn('คำเตือน: มีไฟล์ในโฟลเดอร์ sql ที่ยังไม่ commit จำนวน ' + pending.length + ' รายการ');
      for (const line of pending) console.warn('  ' + line);
      console.warn('เลขไฟล์ที่สร้างใหม่อาจชนกับเครื่องอื่นที่ยังไม่เห็นไฟล์เหล่านี้');
      console.warn('แนะนำให้ git pull และ commit ของที่ค้างอยู่ก่อน แล้วค่อยรันคำสั่งนี้');
      console.warn('');
    }
  } catch {
    // ไม่ใช่ git repo หรือไม่มีคำสั่ง git — ข้ามการเตือน
  }
}

try {
  warnUncommittedSql();

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

  const staff = await pool.query(
    `SELECT sp.full_name,
            sp.position_title,
            sp.line_id,
            sp.phone,
            d.code AS department_code
       FROM staff_profiles sp
       LEFT JOIN departments d ON d.id = sp.department_id
      ORDER BY d.code NULLS LAST, sp.full_name`,
  );

  const number = await nextMigrationNumber();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${number}_sync_governance_data.sql`;

  const lines = [];
  lines.push(`-- ${filename}`);
  lines.push(`-- สร้างอัตโนมัติโดย scripts/export-governance-migration.js เมื่อ ${stamp}`);
  lines.push('--');
  lines.push('-- ซิงก์ข้อมูลหลังบ้านให้ตรงกับฐานข้อมูลต้นทางที่ใช้สร้างไฟล์นี้');
  lines.push('-- ครอบคลุม หน่วยงาน หมวดหมู่และ SLA และทำเนียบเจ้าหน้าที่');
  lines.push('-- ไม่ครอบบัญชีเข้าระบบ (staff_users) เพราะมีรหัสผ่านที่ห้ามส่งออก');
  lines.push('--');
  lines.push('-- รันซ้ำได้ จะเขียนทับรายการที่มีอยู่แล้วให้ตรงกับต้นทาง');
  lines.push('--');
  lines.push('-- หมายเหตุ: ไฟล์นี้ไม่ลบรายการที่ไม่มีในต้นทาง เพื่อไม่ให้ข้อมูลของ');
  lines.push('-- สภาพแวดล้อมอื่นหายโดยไม่ตั้งใจ หากต้องการลบให้เขียน migration แยก');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  // ---------------------------------------------------------------- หน่วยงาน
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

  // ----------------------------------------------------------------- หมวดหมู่
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

  // ------------------------------------------------------- ทำเนียบเจ้าหน้าที่
  lines.push('-- ===== ทำเนียบเจ้าหน้าที่ =====');
  lines.push('-- ตัวระบุตัวตนคือ ชื่อ-สกุล + หน่วยงาน เพราะตารางนี้ไม่มีรหัสประจำตัว');
  lines.push('-- ถ้าเจ้าหน้าที่เปลี่ยนชื่อ-สกุล ระบบจะมองเป็นคนใหม่และเพิ่มแถวเพิ่ม');
  lines.push('--');
  lines.push('-- ระวัง: ไฟล์ 022 มี unique index บน LOWER(line_id) ทั้งตาราง');
  lines.push('-- ถ้าไอดีไลน์ซ้ำกับเจ้าหน้าที่คนอื่นในฐานข้อมูลปลายทาง คำสั่งจะล้มด้วยรหัส 23505');
  if (staff.rowCount) {
    lines.push('WITH incoming (full_name, position_title, line_id, phone, department_code) AS (');
    lines.push('  VALUES');
    lines.push(
      staff.rows
        .map((r, index) => {
          const f = index === 0 ? qTyped : q;
          return `    (${f(r.full_name)}, ${f(r.position_title)}, ${f(r.line_id)}, ${f(r.phone)}, ${f(r.department_code)})`;
        })
        .join(',\n'),
    );
    lines.push('),');
    lines.push('resolved AS (');
    lines.push('  SELECT i.full_name, i.position_title, i.line_id, i.phone, d.id AS department_id');
    lines.push('    FROM incoming i');
    lines.push('    LEFT JOIN departments d ON d.code = i.department_code');
    lines.push('),');
    lines.push('updated AS (');
    lines.push('  UPDATE staff_profiles AS sp');
    lines.push('     SET position_title = r.position_title,');
    lines.push('         line_id        = r.line_id,');
    lines.push('         phone          = r.phone');
    lines.push('    FROM resolved AS r');
    lines.push('   WHERE sp.department_id IS NOT DISTINCT FROM r.department_id');
    lines.push('     AND BTRIM(sp.full_name) = BTRIM(r.full_name)');
    lines.push('  RETURNING sp.id');
    lines.push(')');
    lines.push('INSERT INTO staff_profiles (full_name, position_title, line_id, phone, department_id)');
    lines.push('SELECT r.full_name, r.position_title, r.line_id, r.phone, r.department_id');
    lines.push('  FROM resolved AS r');
    lines.push(' WHERE NOT EXISTS (');
    lines.push('         SELECT 1');
    lines.push('           FROM staff_profiles AS sp');
    lines.push('          WHERE sp.department_id IS NOT DISTINCT FROM r.department_id');
    lines.push('            AND BTRIM(sp.full_name) = BTRIM(r.full_name)');
    lines.push('       );');
  } else {
    lines.push('-- (ไม่มีข้อมูลเจ้าหน้าที่ในฐานข้อมูลต้นทาง)');
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  const target = path.join(sqlDir, filename);
  await fs.writeFile(target, lines.join('\n'), 'utf8');

  const staffWithoutDept = staff.rows.filter((r) => !r.department_code).length;

  console.log(`สร้างไฟล์แล้ว: sql/${filename}`);
  console.log(`  หน่วยงาน         ${departments.rowCount} รายการ`);
  console.log(`  หมวดหมู่          ${categories.rowCount} รายการ`);
  console.log(`  ข้อมูลเจ้าหน้าที่  ${staff.rowCount} คน`);
  if (staffWithoutDept) {
    console.log(`  (ในจำนวนนี้มี ${staffWithoutDept} คนที่ยังไม่ได้ระบุหน่วยงาน)`);
  }
  console.log('');
  console.log('ขั้นตอนต่อไป: เปิดไฟล์ตรวจความถูกต้อง แล้ว commit เข้า git');
  console.log('ฐานข้อมูลอื่นจะได้ข้อมูลชุดนี้เมื่อรัน npm run db:migrate');
} catch (error) {
  console.error('สร้าง migration ไม่สำเร็จ:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
