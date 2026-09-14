BEGIN;

CREATE TEMP TABLE target_staff_users ON COMMIT DROP AS
SELECT id
FROM staff_users
WHERE username IN ('super_engineer', 'officer_engineer');

DO $$
DECLARE
  v_admin_id uuid;
  fk record;
BEGIN
  SELECT id
    INTO v_admin_id
    FROM staff_users
   WHERE role = 'admin'
     AND is_active = true
   ORDER BY created_at
   LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบบัญชี Admin ที่เปิดใช้งานสำหรับรับช่วงข้อมูลอ้างอิง';
  END IF;

  FOR fk IN
    SELECT
      c.conname,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      child_col.attname AS child_column,
      child_col.attnotnull AS is_not_null
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS fk2(attnum, ord)
      ON fk2.ord = ck.ord
    JOIN pg_attribute child_col
      ON child_col.attrelid = child.oid
     AND child_col.attnum = ck.attnum
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = parent.oid
     AND parent_col.attnum = fk2.attnum
    WHERE c.contype = 'f'
      AND parent_ns.nspname = current_schema()
      AND parent.relname = 'staff_users'
      AND parent_col.attname = 'id'
  LOOP
    IF fk.is_not_null THEN
      EXECUTE format(
        'UPDATE %I.%I SET %I = $1 WHERE %I IN (SELECT id FROM target_staff_users)',
        fk.child_schema,
        fk.child_table,
        fk.child_column,
        fk.child_column
      )
      USING v_admin_id;
    ELSE
      EXECUTE format(
        'UPDATE %I.%I SET %I = NULL WHERE %I IN (SELECT id FROM target_staff_users)',
        fk.child_schema,
        fk.child_table,
        fk.child_column,
        fk.child_column
      );
    END IF;
  END LOOP;
END
$$;

DELETE FROM staff_users
WHERE id IN (SELECT id FROM target_staff_users);

COMMIT;

SELECT username, display_name, role, is_active
FROM staff_users
ORDER BY username;
