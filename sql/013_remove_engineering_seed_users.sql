BEGIN;

DELETE FROM staff_users
WHERE username IN ('super_engineer', 'officer_engineer');

COMMIT;

SELECT username, display_name, role, is_active
FROM staff_users
ORDER BY username;
