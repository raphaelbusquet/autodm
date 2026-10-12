-- pending_sends now also holds public comment replies blocked by Meta rate limits.
ALTER TABLE pending_sends ADD COLUMN kind TEXT NOT NULL DEFAULT 'dm';
ALTER TABLE pending_sends ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
