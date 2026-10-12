-- DMs blocked by another app owning the conversation; retried by the cron for up to 24h.
CREATE TABLE pending_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER,
  recipient TEXT NOT NULL,   -- JSON: {"comment_id": ...} or {"id": ...}
  message TEXT NOT NULL,     -- JSON message body
  user_id TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  next_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX pending_next ON pending_sends (next_at);
