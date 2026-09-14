// ตรวจว่าข้อมูลหลังบ้านในฐานข้อมูล ตรงกับที่บันทึกไว้ในไฟล์ migration หรือไม่
//
// ปัญหาที่สคริปต์นี้แก้:
//   เมื่อผู้ดูแลเพิ่มหน่วยงาน หมวดหมู่ หรือเจ้าหน้าที่ผ่านหน้าเว็บ ข้อมูลนั้น
//   จะอยู่เฉพาะในฐานข้อมูลเครื่องนั้น ไม่ติดไปกับโค้ด และไม่มีสัญญาณใดเตือน
//   กว่าจะรู้ตัวก็ตอนย้ายเครื่องแล้วข้อมูลหาย
//
// วิธีใช้:
//   npm run db:check-governance             ตรวจแล้วรายงาน (จบด้วยสถานะปกติเสมอ)
//   npm run db:check-governance -- --strict  ถ้าพบความต่างจะจบด้วยสถานะผิดพลาด
//                                            เหมาะกับการใส่ใน checklist ก่อน deploy
//
// วิธีตรวจ: อ่านไฟล์ .sql ทุกไฟล์ในโฟลเดอร์ sql มารวมเป็นข้อความเดียว
// แล้วดูว่าค่าจากฐานข้อมูลปรากฏอยู่ในข้อความนั้นหรือไม่
// เป็นการตรวจระดับข้อความ ไม่ได้จำลองการรัน SQL จึงบอกได้ว่า
// "ค่านี้ไม่เคยถูกกล่าวถึงในไฟล์ใดเลย" ซึ่งเพียงพอสำหรับการจับข้อมูลที่หลุด
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlDir = path.join(rootDir, 'sql');
const strict = process.argv.slice(2).includes('--strict');

async function readAllMigrations() {
  const files = (await fs.readdir(sqlDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const parts = [];
  for (const name of files) {
    parts.push(await fs.readFile(path.join(sqlDir, name), 'utf8'));
  }
  return { text: parts.join('\n'), count: files.length };
}

function mentions(haystack, needle) {
  if (needle === null || needle === undefined) return true;
  const value = String(needle).trim();
  if (!value) return true;
  return haystack.includes(value);
}

function report(title, total, missing, describe) {
  const pad = (s) => String(s).padEnd(18, ' ');
  if (!missing.length) {
    console.log(`${pad(title)}: ${total} รายการ  ✅ อยู่ในโค้ดครบทั้งหมด`);
    return;
  }
  console.log(`${pad(title)}: ${total} รายการ  ⚠️  มี ${missing.length} รายการที่ไม่มีในโค้ด`);
  for (const row of missing) {
    console.log(`                    - ${describe(row)}`);
  }
}

try {
  const { text: migrationText, count: fileCount } = await readAllMigrations();

  const departments = await pool.query(
    `SELECT code, name_th FROM departments ORDER BY code`,
  );
  const categories = await pool.query(
    `SELECT c.code, c.name_th, d.code AS department_code
       FROM complaint_categories c
       LEFT JOIN departments d ON d.id = c.department_id
      ORDER BY c.sort_order, c.code`,
  );
  const staff = await pool.query(
    `SELECT sp.full_name, sp.position_title, d.code AS department_code, d.name_th AS department_name
       FROM staff_profiles sp
       LEFT JOIN departments d ON d.id = sp.department_id
      ORDER BY d.code NULLS LAST, sp.full_name`,
  );

  const missingDepartments = departments.rows.filter((r) => !mentions(migrationText, r.code));
  const missingCategories = categories.rows.filter((r) => !mentions(migrationText, r.code));
  const missingStaff = staff.rows.filter((r) => !mentions(migrationText, r.full_name));

  console.log('');
  console.log('ตรวจสอบข้อมูลหลังบ้าน เทียบฐานข้อมูลกับไฟล์ใน sql/');
  console.log(`(อ่านไฟล์ migration ทั้งหมด ${fileCount} ไฟล์)`);
  console.log('');

  report('หน่วยงาน', departments.rowCount, missingDepartments, (r) => `${r.code} (${r.name_th})`);
  report('หมวดหมู่', categories.rowCount, missingCategories, (r) => `${r.code} (${r.name_th})`);
  report(
    'ข้อมูลเจ้าหน้าที่',
    staff.rowCount,
    missingStaff,
    (r) => `${r.full_name} — ${r.department_name ?? 'ยังไม่ระบุหน่วยงาน'}`,
  );

  // เรื่องที่ควรรู้เพิ่มเติม แม้ข้อมูลจะอยู่ในโค้ดครบแล้ว
  const unlinkedCategories = categories.rows.filter((r) => !r.department_code);
  const staffWithoutDepartment = staff.rows.filter((r) => !r.department_code);

  if (unlinkedCategories.length || staffWithoutDepartment.length) {
    console.log('');
    console.log('ข้อสังเกตเพิ่มเติม');
    if (unlinkedCategories.length) {
      console.log(`  หมวดหมู่ที่ยังไม่ได้ผูกหน่วยงาน ${unlinkedCategories.length} รายการ`);
      for (const r of unlinkedCategories) console.log(`    - ${r.code} (${r.name_th})`);
    }
    if (staffWithoutDepartment.length) {
      console.log(`  เจ้าหน้าที่ที่ยังไม่ได้ระบุหน่วยงาน ${staffWithoutDepartment.length} คน`);
      for (const r of staffWithoutDepartment) console.log(`    - ${r.full_name}`);
    }
  }

  const driftCount =
    missingDepartments.length + missingCategories.length + missingStaff.length;

  console.log('');
  if (driftCount === 0) {
    console.log('ผลตรวจ: ฐานข้อมูลกับโค้ดตรงกัน ไม่มีข้อมูลตกหล่น');
  } else {
    console.log(`ผลตรวจ: พบข้อมูลที่ยังไม่อยู่ในโค้ด ${driftCount} รายการ`);
    console.log('');
    console.log('แนะนำ:');
    console.log('  1. git pull   เพื่อให้เลขไฟล์ migration ตรงกับเครื่องอื่น');
    console.log('  2. npm run db:export-governance');
    console.log('  3. เปิดไฟล์ที่ได้ตรวจด้วยตา แล้ว commit เข้า git');
    if (strict) process.exitCode = 1;
  }
  console.log('');
} catch (error) {
  console.error('ตรวจสอบไม่สำเร็จ:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
