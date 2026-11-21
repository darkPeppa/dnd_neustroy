CREATE TABLE guest_links (hash TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), role_id TEXT NOT NULL, expires TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL, created_by TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE guest_sessions (link_hash TEXT NOT NULL REFERENCES guest_links(hash), token_hash TEXT NOT NULL, user_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE time_slots (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), user_id TEXT NOT NULL, name TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, timezone TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX time_slots_campaign ON time_slots(campaign_id,start,end);
--> statement-breakpoint
CREATE TABLE clue_text (clue_id TEXT PRIMARY KEY REFERENCES clues(id) ON DELETE CASCADE, text TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER folder_parent_update BEFORE UPDATE OF parent_id,campaign_id ON folders WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'FOLDER_CYCLE') WHERE NEW.id=NEW.parent_id OR EXISTS (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,parent_id FROM folders WHERE id=NEW.parent_id UNION SELECT f.id,f.parent_id FROM folders f JOIN parents p ON f.id=p.parent_id) SELECT 1 FROM parents WHERE id=NEW.id);
 SELECT RAISE(ABORT,'FOLDER_CAMPAIGN') WHERE NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.parent_id AND campaign_id=NEW.campaign_id);
END;
--> statement-breakpoint
CREATE TRIGGER folder_parent_insert BEFORE INSERT ON folders WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'FOLDER_CAMPAIGN') WHERE NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.parent_id AND campaign_id=NEW.campaign_id);
END;
