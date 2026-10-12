CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube')),
  trigger TEXT NOT NULL DEFAULT 'comment' CHECK (trigger IN ('comment', 'dm')),
  media_ids TEXT NOT NULL DEFAULT '[]',        -- JSON array; empty = all posts
  keywords TEXT NOT NULL DEFAULT '[]',         -- JSON array; empty = any text
  match_mode TEXT NOT NULL DEFAULT 'contains' CHECK (match_mode IN ('contains', 'exact')),
  public_replies TEXT NOT NULL DEFAULT '[]',   -- JSON array; one picked at random
  dm_text TEXT NOT NULL DEFAULT '',
  button_label TEXT NOT NULL DEFAULT '',
  require_follow INTEGER NOT NULL DEFAULT 0,
  not_following_text TEXT NOT NULL DEFAULT '',
  link_text TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  link_button_label TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE contacts (
  platform TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (platform, user_id)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER,
  platform TEXT NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX events_rule_type ON events (rule_id, type);
CREATE INDEX events_created ON events (created_at);
CREATE INDEX events_user ON events (rule_id, user_id, type, created_at);

-- Webhook/poll dedup: comment ids, message ids.
CREATE TABLE processed (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
