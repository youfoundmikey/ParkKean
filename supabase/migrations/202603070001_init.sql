CREATE TABLE IF NOT EXISTS lots (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  occupancy INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',
  walk_time INTEGER DEFAULT 0,
  full_by TEXT,
  last_updated BIGINT DEFAULT 0,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  email_lower TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::BIGINT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  last_latitude DOUBLE PRECISION,
  last_longitude DOUBLE PRECISION,
  location_accuracy DOUBLE PRECISION,
  location_updated_at BIGINT,
  last_eco_log_date TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT NOT NULL REFERENCES lots(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  reported_status TEXT NOT NULL,
  note TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_lot_created ON reports(lot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lot_history (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  hour_block INTEGER NOT NULL,
  avg_occupancy_pct INTEGER NOT NULL,
  UNIQUE(lot_id, day_of_week, hour_block)
);

CREATE TABLE IF NOT EXISTS buildings (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS building_lot_walks (
  building_id BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  lot_id BIGINT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (building_id, lot_id)
);

CREATE TABLE IF NOT EXISTS system_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lot_id BIGINT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at BIGINT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON notifications(recipient_id, created_at DESC);
