CREATE TABLE telegram_links (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL, expires TEXT NOT NULL);
CREATE TABLE telegram_users (chat_id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, campaign_id TEXT REFERENCES campaigns(id));
CREATE TABLE telegram_login_codes (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, expires TEXT NOT NULL);
CREATE TABLE telegram_updates (bot_id TEXT NOT NULL, id INTEGER NOT NULL, created_at TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '', PRIMARY KEY(bot_id,id));
CREATE INDEX telegram_login_expiry ON telegram_login_codes(expires);
ALTER TABLE native_tokens ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
