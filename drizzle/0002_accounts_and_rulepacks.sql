CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE account_sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE rule_packs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX account_session_owner ON account_sessions(user_id);
--> statement-breakpoint
CREATE INDEX rule_pack_owner ON rule_packs(user_id);
