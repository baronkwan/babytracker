-- BabyLog D1 Schema
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
  type TEXT NOT NULL,
  volume INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 0,
  side TEXT,
  notes TEXT DEFAULT '',
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS excretes (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  color TEXT DEFAULT '',
  consistency TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by TEXT
);

-- Seed one baby record
INSERT OR IGNORE INTO baby (id, name, dob) VALUES (1, '寶寶', '2026-01-01');
