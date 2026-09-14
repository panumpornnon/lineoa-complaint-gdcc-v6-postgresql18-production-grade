import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ไม่พบตัวแปร DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
});

const departments = [
  ['PUBLIC_HEALTH', 'กองสาธารณสุขและสิ่งแวดล้อม'],
  ['TRAFFIC', 'งานเทศกิจและจราจร'],
  ['DISASTER', 'งานป้องกันและบรรเทาสาธารณภัย'],
  ['PUBLIC_WORKS', 'งานรักษาความสะอาด'],
  ['CENTRAL', 'ศูนย์รับเรื่องและประสานงาน'],
];

const client = await pool.connect();

try {
  await client.query('BEGIN');

  for (const [code, nameTh] of departments) {
    await client.query(
      `
      INSERT INTO departments (code, name_th, is_active)
      VALUES ($1, $2, true)
      ON CONFLICT (code)
      DO UPDATE SET
        name_th = EXCLUDED.name_th,
        is_active = true,
        updated_at = current_timestamp
      `,
      [code, nameTh],
    );
  }

  await client.query('COMMIT');

  const result = await client.query(
    `
    SELECT code, name_th, is_active
    FROM departments
    WHERE code = ANY($1::text[])
    ORDER BY code
    `,
    [departments.map(([code]) => code)],
  );

  console.table(result.rows);
  console.log('เพิ่ม/อัปเดตหน่วยงานเรียบร้อย');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('ดำเนินการไม่สำเร็จ:', error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
