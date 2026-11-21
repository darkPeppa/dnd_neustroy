ALTER TABLE campaigns ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE members ADD COLUMN role_id TEXT NOT NULL DEFAULT 'player';
UPDATE members SET role_id='gm' WHERE user_id=(SELECT owner_id FROM campaigns WHERE id=campaign_id);
--> statement-breakpoint
CREATE TABLE campaign_roles (campaign_id TEXT NOT NULL REFERENCES campaigns(id), id TEXT NOT NULL, name TEXT NOT NULL, permissions TEXT NOT NULL, PRIMARY KEY(campaign_id,id));
--> statement-breakpoint
CREATE TABLE folders (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), parent_id TEXT REFERENCES folders(id), name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, visible_roles TEXT NOT NULL DEFAULT '[]', recipients TEXT NOT NULL DEFAULT '[]');
ALTER TABLE clues ADD COLUMN folder_id TEXT REFERENCES folders(id);
ALTER TABLE clues ADD COLUMN visible_roles TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE notes (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), user_id TEXT NOT NULL, author_name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', folder_id TEXT REFERENCES folders(id), session_id TEXT REFERENCES sessions(id), links TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
ALTER TABLE characters ADD COLUMN portrait_key TEXT;
ALTER TABLE characters ADD COLUMN portrait_mime TEXT;
--> statement-breakpoint
CREATE TABLE password_resets (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX password_reset_owner ON password_resets(user_id);
--> statement-breakpoint
CREATE INDEX notes_campaign ON notes(campaign_id,updated_at);
--> statement-breakpoint
CREATE INDEX folders_campaign ON folders(campaign_id,parent_id,position);
