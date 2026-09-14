import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlDirectory = path.resolve(__dirname, '../sql');

async function relationExists(relationName) {
  const result = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${relationName}`],
  );
  return result.rows[0].exists;
}

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename varchar(255) PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT current_timestamp
    )
  `);

  const existingApplicationSchema = await relationExists('complaints');
  const trackingCount = await pool.query(
    `SELECT count(*)::integer AS total FROM schema_migrations`,
  );

  // รองรับฐานข้อมูลที่ติดตั้งด้วยโครงการรุ่น 1.0 ซึ่งยังไม่มี migration tracking
  if (existingApplicationSchema && trackingCount.rows[0].total === 0) {
    for (const baseline of ['001_schema.sql', '002_seed.sql']) {
      const filePath = path.join(sqlDirectory, baseline);
      const sql = await fs.readFile(filePath, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await pool.query(
        `INSERT INTO schema_migrations (filename, checksum)
         VALUES ($1, $2)
         ON CONFLICT (filename) DO NOTHING`,
        [baseline, checksum],
      );
    }
    console.log('Detected version 1.0 database; baseline migrations recorded.');
  }

  const files = (await fs.readdir(sqlDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const sql = await fs.readFile(path.join(sqlDirectory, filename), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    const applied = await pool.query(
      `SELECT checksum FROM schema_migrations WHERE filename = $1`,
      [filename],
    );

    if (applied.rowCount > 0) {
      if (applied.rows[0].checksum !== checksum) {
        throw new Error(
          `Migration ${filename} was modified after being applied. Create a new migration instead.`,
        );
      }
      console.log(`Skipping ${filename}; already applied.`);
      continue;
    }

    // Migration 013 already removes these seed accounts on fresh installs.
    // In that case, 016 has no references to transfer and must not require an
    // administrator account before the documented admin:create step.
    if (filename === '016_remove_engineering_seed_users_v3.sql') {
      const seedUsers = await pool.query(
        `SELECT count(*)::integer AS total
           FROM staff_users
          WHERE username IN ('super_engineer', 'officer_engineer')`,
      );

      if (seedUsers.rows[0].total === 0) {
        await pool.query(
          `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
          [filename, checksum],
        );
        console.log(`Skipping ${filename}; seed users are already absent.`);
        continue;
      }
    }

    console.log(`Running ${filename}...`);
    await pool.query(sql);
    await pool.query(
      `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
      [filename, checksum],
    );
  }

  console.log('Database migration completed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
