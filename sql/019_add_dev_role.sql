-- Add the DEV role. Application authorization treats DEV as a system
-- administrator, while keeping it distinct in audit logs and user lists.
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'dev';
