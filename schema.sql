-- BabyTracker D1 Schema
-- Run: wrangler d1 execute babylog --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS baby (
  id INTEGER PRIMARY KEY,
  name TEXT DEFAULT '寶寶',
  dob TEXT,
  notes TEXT DEFAULT '',
  birth_weight INTEGER DEFAULT 0,
  gender TEXT DEFAULT '',
  unit TEXT DEFAULT 'ml'
);

CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  breast_volume INTEGER DEFAULT 0,
  formula_volume INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 0,
  side TEXT,
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS excretes (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  pee_size TEXT DEFAULT '',
  poo_size TEXT DEFAULT '',
  color TEXT DEFAULT '',
  consistency TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS weights (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  weight INTEGER NOT NULL,
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id)
);

-- Hot paths: time-sorted listing + per-day bucketing
CREATE INDEX IF NOT EXISTS idx_feeds_timestamp ON feeds(timestamp);
CREATE INDEX IF NOT EXISTS idx_excretes_timestamp ON excretes(timestamp);
CREATE INDEX IF NOT EXISTS idx_weights_timestamp ON weights(timestamp);

-- Seed one baby record
INSERT OR IGNORE INTO baby (id, name, dob) VALUES (1, '寶寶', '2026-01-01');
