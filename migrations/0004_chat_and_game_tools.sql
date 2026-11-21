CREATE TABLE chat_messages (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), author_id TEXT NOT NULL, author_name TEXT NOT NULL, recipient_id TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX chat_campaign ON chat_messages(campaign_id,created_at,id);
ALTER TABLE campaigns ADD COLUMN rules_config TEXT NOT NULL DEFAULT '{"mode":"rules","edition":"srd-2024","enabledModules":["*"]}';
CREATE TABLE game_documents (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, gm_secret TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'shared', roles TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX game_documents_campaign ON game_documents(campaign_id,kind,updated_at);
CREATE TABLE game_log (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), session_id TEXT REFERENCES sessions(id), user_id TEXT NOT NULL, user_name TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL);
CREATE INDEX game_log_campaign ON game_log(campaign_id,created_at);
