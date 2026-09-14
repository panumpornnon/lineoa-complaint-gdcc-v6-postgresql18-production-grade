BEGIN;

-- Backfill complaints created before category SLA deadlines were applied.
UPDATE complaints c
   SET due_at = c.created_at + make_interval(hours => cc.sla_hours),
       updated_at = current_timestamp
  FROM complaint_categories cc
 WHERE c.category_id = cc.id
   AND c.due_at IS NULL;

COMMIT;
