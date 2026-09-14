BEGIN;

CREATE TYPE complaint_status AS ENUM (
  'new',
  'received',
  'assigned',
  'in_progress',
  'waiting_for_info',
  'completed',
  'rejected',
  'cancelled'
);

CREATE TYPE staff_role AS ENUM (
  'officer',
  'supervisor',
  'admin'
);

CREATE TYPE history_actor_type AS ENUM (
  'citizen',
  'staff',
  'system'
);

CREATE SEQUENCE complaint_reference_seq START WITH 1;

CREATE TABLE complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(50) NOT NULL UNIQUE,
  name_th varchar(200) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE TABLE staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(100) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  display_name varchar(200) NOT NULL,
  role staff_role NOT NULL DEFAULT 'officer',
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE TABLE complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no varchar(30) NOT NULL UNIQUE,
  line_user_id varchar(64) NOT NULL,
  line_display_name varchar(255),
  category_id uuid NOT NULL REFERENCES complaint_categories(id),
  title varchar(200) NOT NULL,
  description text NOT NULL,
  location_text varchar(500) NOT NULL,
  latitude numeric(9,6),
  longitude numeric(9,6),
  contact_name varchar(200) NOT NULL,
  contact_phone varchar(20) NOT NULL,
  contact_email varchar(254),
  status complaint_status NOT NULL DEFAULT 'new',
  privacy_consent_at timestamptz NOT NULL,
  privacy_consent_version varchar(30) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT valid_coordinates CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR
    (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  )
);

CREATE TABLE complaint_status_history (
  id bigserial PRIMARY KEY,
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  old_status complaint_status,
  new_status complaint_status NOT NULL,
  note text,
  actor_type history_actor_type NOT NULL,
  actor_line_user_id varchar(64),
  actor_staff_user_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX complaints_line_user_id_idx
  ON complaints (line_user_id, created_at DESC);

CREATE INDEX complaints_status_idx
  ON complaints (status, created_at DESC);

CREATE INDEX complaints_category_idx
  ON complaints (category_id, created_at DESC);

CREATE INDEX complaint_history_complaint_idx
  ON complaint_status_history (complaint_id, created_at ASC);

COMMIT;
