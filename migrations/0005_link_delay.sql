-- Delay the final link after the follow is confirmed, then re-check the follow before sending.
ALTER TABLE rules ADD COLUMN wait_text TEXT NOT NULL DEFAULT '';
ALTER TABLE rules ADD COLUMN link_delay_minutes INTEGER NOT NULL DEFAULT 0;
UPDATE rules SET link_delay_minutes = 20 WHERE require_follow = 1;
