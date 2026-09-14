BEGIN;

CREATE TABLE IF NOT EXISTS webhook_events (
  webhook_event_id varchar(100) PRIMARY KEY,
  event_type varchar(50) NOT NULL,
  source_user_id varchar(100),
  received_at timestamptz NOT NULL DEFAULT current_timestamp,
  processed_at timestamptz,
  processing_status varchar(20) NOT NULL DEFAULT 'received',
  error_message text
);

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS complaints_due_status_idx
  ON complaints (due_at, status)
  WHERE due_at IS NOT NULL;

COMMIT;
