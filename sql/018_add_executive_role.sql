-- Executive: read-only access across every department.
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'executive';
