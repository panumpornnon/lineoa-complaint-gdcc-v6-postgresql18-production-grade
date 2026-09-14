-- ---------------------------------------------------------------------------
-- 032_seed_staff_profiles_engineering.sql
-- ข้อมูลเจ้าหน้าที่ของ "กองช่าง" (departments.code = 'ENGINEERING')
--
-- แยกไฟล์ตามหน่วยงาน เพื่อให้เพิ่มหน่วยงานอื่นในภายหลังได้โดยไม่ต้องแตะไฟล์นี้
-- ซึ่งเมื่อถูก apply แล้วจะแก้ไม่ได้อีก (checksum ใน schema_migrations)
--
-- ตัวระบุตัวตน: ชื่อ-สกุล + หน่วยงาน
--   ถ้าในกองช่างมีเจ้าหน้าที่ชื่อนี้อยู่แล้ว จะปรับปรุงตำแหน่ง ไอดีไลน์ และเบอร์โทร
--   ถ้ายังไม่มี จะเพิ่มแถวใหม่
--   ไม่ได้ใช้ไอดีไลน์เป็นตัวระบุ เพราะไอดีไลน์เปลี่ยนได้และบางคนอาจไม่มี
--
-- ไม่มีการลบเจ้าหน้าที่ที่ไม่อยู่ในรายการนี้ เพื่อไม่ให้ข้อมูลของ
-- สภาพแวดล้อมอื่นหายโดยไม่ตั้งใจ
--
-- ข้อควรทราบ: ไฟล์ 022 สร้าง unique index บน LOWER(line_id) ไว้ทั้งตาราง
--   ถ้าไอดีไลน์ในรายการนี้ไปซ้ำกับเจ้าหน้าที่ของหน่วยงานอื่นที่บันทึกไว้ก่อน
--   คำสั่งจะล้มด้วยรหัส 23505 ซึ่งเป็นพฤติกรรมที่ต้องการ เพราะแปลว่าข้อมูลขัดกัน
--   และควรตรวจสอบก่อนว่าไอดีไลน์นั้นเป็นของใครกันแน่
-- ---------------------------------------------------------------------------

BEGIN;

WITH incoming (full_name, position_title, line_id, phone) AS (
  VALUES
    ('นายสถิตย์ หนูปลอด'::varchar,      'หัวหน้าฝ่ายวิศวกรรมโยธา'::varchar,     '0806493041'::varchar,   '080-649-3041'::varchar),
    ('นายอนุภาพ เพชรมีศรี',              'วิศวกรโยธาชำนาญการพิเศษ',              'kaa_66',                '086-947-4266'),
    ('นายสมศักดิ์ ทวีทอง',               'นายช่างไฟฟ้าอาวุโส',                    'saktawethong',          '081-676-7058'),
    ('น.ส.วันวิสา วุฒิ',                  'นายช่างโยธาชำนาญงาน',                  '0869417857',            '086-941-7857'),
    ('น.ส.กมลทิพย์ อินทวิเศษ',           'ผู้ช่วยนักจัดการงานทั่วไป',              '0857969164',            '094-451-7845'),
    ('น.ส.กชพร เจริญพัฒนคุณ',            'นักผังเมืองปฏิบัติการ',                  'pondawaken',            '091-979-6915'),
    ('นายวิโรจน์ ปัญจเภรี',               'ผู้ช่วยนายช่างโยธา',                    '0869495477',            '086-949-5477'),
    ('น.ส.จิตต์ศิริ ศรีสุวรรณ',            'ผู้ช่วยเจ้าพนักงานธุรการ',               'fonsrisuwan',           '093-593-7022'),
    ('น.ส.ดวงกมล แก้วคงคา',              'ผู้ช่วยเจ้าพนักงานธุรการ',               'gromgig23',             '062-636-3614'),
    ('น.ส.พรทิพย์ ทองชิต',               'พนักงานจ้างทั่วไป',                     'JANG_37',               '096-807-4044')
),
dept AS (
  SELECT id FROM departments WHERE code = 'ENGINEERING'
),
-- 1. ปรับปรุงเจ้าหน้าที่ที่มีชื่อนี้อยู่แล้วในกองช่าง
updated AS (
  UPDATE staff_profiles AS sp
     SET position_title = i.position_title,
         line_id        = i.line_id,
         phone          = i.phone
    FROM incoming AS i, dept
   WHERE sp.department_id = dept.id
     AND BTRIM(sp.full_name) = BTRIM(i.full_name)
  RETURNING sp.id
)
-- 2. เพิ่มเจ้าหน้าที่ที่ยังไม่มีในกองช่าง
INSERT INTO staff_profiles (full_name, position_title, line_id, phone, department_id)
SELECT i.full_name, i.position_title, i.line_id, i.phone, dept.id
  FROM incoming AS i
  CROSS JOIN dept
 WHERE NOT EXISTS (
         SELECT 1
           FROM staff_profiles AS sp
          WHERE sp.department_id = dept.id
            AND BTRIM(sp.full_name) = BTRIM(i.full_name)
       );

COMMIT;

-- ---------------------------------------------------------------------------
-- ตรวจสอบผลลัพธ์: ต้องได้ 10 แถว และหน่วยงานต้องเป็น กองช่าง ทุกแถว
-- ---------------------------------------------------------------------------
SELECT sp.full_name, sp.position_title, sp.line_id, sp.phone, d.name_th AS department
  FROM staff_profiles sp
  JOIN departments d ON d.id = sp.department_id
 WHERE d.code = 'ENGINEERING'
 ORDER BY sp.full_name;
